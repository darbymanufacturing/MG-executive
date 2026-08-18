/**
 * _mcp.js — Omni's remote MCP server (streamable HTTP, stateless), served at
 * POST /api/mcp?key=<MCP_SHARED_TOKEN> via the api/[...path].js catch-all.
 *
 * Lets external AI clients (claude.ai / Claude Cowork custom connectors,
 * ChatGPT custom connectors, Claude Code `mcp add --transport http`) read the
 * company's live financial + operational data and add costs. One org (env
 * MCP_ORG_ID, default mg-executive-org); reads use the service-role Supabase
 * client server-side — nothing here is exposed without the shared token.
 *
 * AUTH — capability URL: the token travels as ?key= (or Authorization: Bearer).
 * Consumer connector UIs (claude.ai, ChatGPT) only take a URL, so the token
 * lives in it; treat the full URL as a secret. Rotation = change the
 * MCP_SHARED_TOKEN env var on Vercel and update the URL in the clients.
 * With the env var unset the endpoint answers 503 for everything (safe default).
 *
 * TOOLS (pattern: one tool per action; 17 tools, still inside the workable band):
 *   Finance   — get_financial_summary · list_costs · list_recurring ·
 *               get_planner_month · get_bank_import_status · list_loans ·
 *               get_owner_ledger · list_revenue_days
 *   Fleet     — get_fleet_summary · list_scooters
 *   Ops       — get_maintenance_summary · list_maintenance_tickets · list_issues
 *   Projects  — list_projects
 *   Write     — add_cost (the only mutating tool)
 *   Lookup    — search · fetch (ChatGPT compatibility pair; Claude gets two
 *               extra lookup tools for free)
 *
 * CANONICAL NUMBERS (ADR-0024 spirit): get_financial_summary (month mode) and
 * get_planner_month both delegate to buildPlannerModel() from
 * src/utils/financialPlanner.js — the SAME pure engine that renders the /pulse
 * Financial Planner page (ADR-0028). That guarantees the two tools agree with
 * each other and with what the owner sees in the app; nothing here recomputes
 * category buckets by hand anymore (SOFTWARE/STAFF/DIVIDEND/EXCLUDED_CATEGORIES
 * and bucketForCategory are imported, not copied — the prior local copies had
 * silently drifted out of sync risk flagged in ADR-0029 point 5).
 * Deliberately NOT financialSummary.js/MetricsContext — that engine powers
 * Dashboard/PulseStrip (/pulse/classic), a different page with a different
 * revenue basis (net of Hopp's franchise fee); using it here would make this
 * tool's numbers disagree with /pulse, the actual source of truth today.
 *
 * Stateless per-request server: a fresh McpServer + StreamableHTTPServerTransport
 * per POST (sessionIdGenerator: undefined, JSON responses) — the documented
 * serverless pattern; no session affinity needed on Vercel.
 */
import { timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { supabaseAdmin, sbGetDoc } from './_lib/supabase-admin.js';
import { SUPABASE_TABLE } from '../src/lib/supabaseRowMap.js';
import {
  LOAN_INTEREST_RE, bucketForCategory, buildPlannerModel, chainedOpenings,
} from '../src/utils/financialPlanner.js';
import { signedAmount } from '../src/utils/ownerLedger.js';

const ORG = () => process.env.MCP_ORG_ID || 'mg-executive-org';
const CONFIG_DOC_ID = () => `${ORG()}_fleet`;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const inMonth = (dateStr, ym) => typeof dateStr === 'string' && dateStr.startsWith(ym);
const validYm = (ym) => /^\d{4}-(0[1-9]|1[0-2])$/.test(ym);

function json(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 1) }] };
}

/** MCP tool error (isError: true) — distinct from a normal JSON payload that
 * happens to contain an "error" field; this is what stops a thrown Supabase/
 * network error from becoming a raw HTTP 500 that kills the JSON-RPC response. */
function errorResult(message) {
  return { isError: true, content: [{ type: 'text', text: String(message) }] };
}

/** Wrap a tool handler so any thrown error becomes an MCP tool error, not a 500. */
function guarded(handler) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      return errorResult(`Internal error: ${err.message}`);
    }
  };
}

/* ── data access (service role; org-scoped; memoized per request) ─────────── */
async function fetchAllRows(supa, table, orgId, limit) {
  const rows = [];
  let truncated = false;
  for (let from = 0; from < limit; from += 1000) {
    const { data, error } = await supa
      .from(table)
      .select('source_doc_id,data')
      .eq('org_id', orgId)
      .range(from, Math.min(from + 999, limit - 1));
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
    if (rows.length >= limit) { truncated = true; break; }
  }
  return {
    rows: rows.map((r) => ({ _docId: r.source_doc_id, ...(r.data || {}) })),
    truncated,
  };
}

/* ── the server ─────────────────────────────────────────────────────────── */
// Exported (in addition to the default HTTP handler) so tests can drive the
// server directly over an InMemoryTransport, without simulating raw HTTP.
export function buildServer() {
  const supa = supabaseAdmin();
  const cache = new Map();

  /** collection = the logical (camelCase) name in SUPABASE_TABLE, e.g. 'costs',
   * 'revenue', 'scooters', 'maintenanceTickets', 'issues', 'projects', 'loans',
   * 'ownerLedger'. Resolves the real table name and caches per (collection,limit)
   * for the life of this request — several tools fetch the same table twice. */
  async function fetchAll(collection, { limit = 3000 } = {}) {
    const cacheKey = `${collection}:${limit}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    if (!supa) throw new Error('Supabase admin env vars not configured');
    const table = SUPABASE_TABLE[collection] || collection;
    const result = await fetchAllRows(supa, table, ORG(), limit);
    cache.set(cacheKey, result);
    return result;
  }

  const server = new McpServer(
    { name: 'omni-fleet-finance', version: '2.0.0' },
    {
      instructions:
        'Omni is a Greek micromobility (e-scooter rental) company. All amounts are EUR. '
        + 'Cost rows are cash records (bank/wallet imports + manual entries); revenue rows are daily per-city trip revenue stored ex-VAT. '
        + 'Categories follow the owner\'s bookkeeping (43 categories); "Transfer, withdraw" rows are internal money movements, not expenses. '
        + 'Use get_financial_summary for headline numbers, get_planner_month for a month\'s Financial Planner sheet (same as the app\'s /pulse page), '
        + 'get_fleet_summary / get_maintenance_summary for operational headlines, and the list_* tools to inspect individual records.',
    },
  );

  /* ── finance ──────────────────────────────────────────────────────────── */

  server.registerTool('get_financial_summary', {
    title: 'Financial summary',
    description: 'Headline financials for a month (YYYY-MM) or all time: revenue (ex-VAT), cash costs (dated cost rows; internal transfers excluded), net cash flow, dividends (owner draw), plus counts. Month mode matches the /pulse Financial Planner exactly (same engine as get_planner_month).',
    inputSchema: { month: z.string().optional().describe('YYYY-MM; omit for all-time') },
    annotations: { readOnlyHint: true, title: 'Financial summary' },
  }, guarded(async ({ month }) => {
    if (month && !validYm(month)) return errorResult('month must be YYYY-MM');
    const [{ rows: costs }, { rows: revenue }] = await Promise.all([
      fetchAll('costs'), fetchAll('revenue', { limit: 6000 }),
    ]);

    if (month) {
      const year = Number(month.slice(0, 4));
      const config = (await sbGetDoc('app_config', CONFIG_DOC_ID())) || {};
      const openings = chainedOpenings({ costs, revenue, openings: config.plannerOpening || {} });
      const openingBalance = openings[year]?.opening ?? (Number(config.plannerOpening?.[year]) || 0);
      const model = buildPlannerModel({ costs, revenue, year, openingBalance });
      const m = model.months.find((mm) => mm.key === month);
      const transfers = costs.filter((c) => c.frequency === 'one-time' && inMonth(c.startDate, month)
        && bucketForCategory(c.category) === 'excluded');
      return json({
        period: month,
        revenue_ex_vat: m.summary.revenue,
        cash_costs: m.summary.expenses,
        net_cash_flow: m.summary.netCashFlow,
        dividends_owner_draw: m.summary.dividends,
        retained_earnings: m.summary.retained,
        opening_balance: m.summary.opening,
        closing_balance: m.summary.closing,
        internal_transfers_excluded: round2(transfers.reduce((s, c) => s + (Number(c.amount) || 0), 0)),
        revenue_days: new Set(revenue.filter((r) => inMonth(r.date, month)).map((r) => r.date)).size,
        note: 'Matches the /pulse Financial Planner for this month exactly (same buildPlannerModel() call as get_planner_month).',
      });
    }

    // All-time: lifetime sums. buildPlannerModel is inherently per-year with a
    // chained opening balance, so there is no single canonical "all-time" call to
    // defer to here — this sums every one-time cost/revenue row ever recorded.
    const oneTime = costs.filter((c) => c.frequency === 'one-time' && !LOAN_INTEREST_RE.test(c.name || ''));
    const spent = oneTime.filter((c) => {
      const b = bucketForCategory(c.category);
      return b !== 'excluded' && b !== 'dividend';
    });
    const dividends = oneTime.filter((c) => bucketForCategory(c.category) === 'dividend');
    const transfers = oneTime.filter((c) => bucketForCategory(c.category) === 'excluded');
    const revTotal = round2(revenue.reduce((s, r) => s + (Number(r.totalPaidRevenue) || 0), 0));
    const costTotal = round2(spent.reduce((s, c) => s + (Number(c.amount) || 0), 0));
    return json({
      period: 'all-time',
      revenue_ex_vat: revTotal,
      cash_costs: costTotal,
      net_cash_flow: round2(revTotal - costTotal),
      dividends_owner_draw: round2(dividends.reduce((s, c) => s + (Number(c.amount) || 0), 0)),
      internal_transfers_excluded: round2(transfers.reduce((s, c) => s + (Number(c.amount) || 0), 0)),
      cost_entries: spent.length,
      revenue_days: new Set(revenue.map((r) => r.date)).size,
      note: 'Cash view: dated one-time cost rows only; recurring commitments are in list_recurring. Loan-interest P&L split rows excluded (the bank debits carry the cash).',
    });
  }));

  server.registerTool('list_costs', {
    title: 'List costs',
    description: 'List cost entries (newest first). Filter by month (YYYY-MM), category (exact, e.g. "Fuel", "VAT", "Bank loans"), or free-text query on name/notes.',
    inputSchema: {
      month: z.string().optional(),
      category: z.string().optional(),
      query: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional().describe('default 25'),
    },
    annotations: { readOnlyHint: true, title: 'List costs' },
  }, guarded(async ({ month, category, query, limit }) => {
    if (month && !validYm(month)) return errorResult('month must be YYYY-MM');
    const { rows: costs, truncated } = await fetchAll('costs');
    const q = (query || '').toLowerCase();
    const rows = costs
      .filter((c) => (!month || inMonth(c.startDate, month))
        && (!category || c.category === category)
        && (!q || `${c.name} ${c.notes || ''}`.toLowerCase().includes(q)))
      .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')))
      .slice(0, limit || 25)
      .map((c) => ({ id: c.id, date: c.startDate, name: c.name, amount: c.amount, category: c.category, frequency: c.frequency, location: c.location || null, source: c.source || 'manual' }));
    return json({ count: rows.length, ...(truncated ? { truncated: true } : {}), costs: rows });
  }));

  server.registerTool('list_recurring', {
    title: 'List recurring commitments',
    description: 'The standing recurring commitments (rent, subscriptions, loan instalments, wages) with per-month equivalents — the forward run-rate, separate from dated cash entries.',
    inputSchema: {},
    annotations: { readOnlyHint: true, title: 'List recurring commitments' },
  }, guarded(async () => {
    const { rows: costs } = await fetchAll('costs');
    const MULT = { monthly: 1, quarterly: 1 / 3, annual: 1 / 12, yearly: 1 / 12, weekly: 52 / 12, daily: 365 / 12 };
    const rec = costs.filter((c) => c.frequency && c.frequency !== 'one-time'
      && !(c.endDate && c.endDate < new Date().toISOString().slice(0, 10)));
    const items = rec.map((c) => ({
      name: c.name, category: c.category, frequency: c.frequency, amount: c.amount,
      monthly_equivalent: round2((Number(c.amount) || 0) * (MULT[c.frequency] || 0)),
    })).sort((a, b) => b.monthly_equivalent - a.monthly_equivalent);
    return json({ count: items.length, monthly_run_rate: round2(items.reduce((s, i) => s + i.monthly_equivalent, 0)), commitments: items });
  }));

  server.registerTool('get_planner_month', {
    title: 'Planner month',
    description: 'One month of the Financial Planner exactly as shown on the app\'s /pulse page: revenue by city, expenses bucketed Software/Staff/Others, dividends (owner draw), and opening/closing balance. Month = YYYY-MM.',
    inputSchema: { month: z.string().describe('YYYY-MM') },
    annotations: { readOnlyHint: true, title: 'Planner month' },
  }, guarded(async ({ month }) => {
    if (!validYm(month)) return errorResult('month must be YYYY-MM');
    const [{ rows: costs }, { rows: revenue }] = await Promise.all([
      fetchAll('costs'), fetchAll('revenue', { limit: 6000 }),
    ]);
    const year = Number(month.slice(0, 4));
    const config = (await sbGetDoc('app_config', CONFIG_DOC_ID())) || {};
    const openings = chainedOpenings({ costs, revenue, openings: config.plannerOpening || {} });
    const openingBalance = openings[year]?.opening ?? (Number(config.plannerOpening?.[year]) || 0);
    const model = buildPlannerModel({ costs, revenue, year, openingBalance });
    const m = model.months.find((mm) => mm.key === month);
    if (!m) return errorResult(`No planner data for ${month}`);
    return json({
      month,
      revenue_by_city: Object.fromEntries(m.revenueItems.map((r) => [r.label, r.amount])),
      expense_buckets: {
        software: m.expenseGroups.software,
        staff: m.expenseGroups.staff,
        others: m.expenseGroups.others,
      },
      dividends: m.dividendItems,
      totals: m.summary,
    });
  }));

  server.registerTool('get_bank_import_status', {
    title: 'Bank import status',
    description: 'How current the imported bank data is: latest transaction date, covered range, and the date the next Alpha Bank CSV export should start from.',
    inputSchema: {},
    annotations: { readOnlyHint: true, title: 'Bank import status' },
  }, guarded(async () => {
    const { rows: costs } = await fetchAll('costs');
    const bank = costs.filter((c) => c.source === 'alphabank-csv' && c.startDate);
    if (!bank.length) return json({ imported: 0, note: 'No bank CSV imported yet.' });
    const dates = bank.map((c) => c.startDate).sort();
    const latest = dates[dates.length - 1];
    const next = new Date(latest); next.setDate(next.getDate() + 1);
    return json({
      imported: bank.length,
      earliest_transaction: dates[0],
      latest_transaction: latest,
      next_export_from: next.toISOString().slice(0, 10),
      note: 'Re-importing overlapping ranges is safe (deduped by bank transaction id).',
    });
  }));

  server.registerTool('list_loans', {
    title: 'List loans',
    description: 'All tracked debts (bank loans and credit cards): balances, payments logged, latest activity.',
    inputSchema: {},
    annotations: { readOnlyHint: true, title: 'List loans' },
  }, guarded(async () => {
    const { rows: loans } = await fetchAll('loans');
    return json({
      count: loans.length,
      total_outstanding: round2(loans.reduce((s, l) => s + (Number(l.currentBalance) || 0), 0)),
      loans: loans.map((l) => ({
        id: l._docId, name: l.name || l.loanNumber, type: l.type || 'loan', lender: l.lender || null,
        current_balance: l.currentBalance ?? null, interest_rate: l.interestRate ?? null,
        monthly_payment: l.monthlyPayment ?? l.minimumPayment ?? null,
        entries_logged: Array.isArray(l.entries) ? l.entries.length : 0,
        latest_entry: Array.isArray(l.entries) && l.entries.length ? l.entries[l.entries.length - 1]?.date ?? null : null,
      })),
    });
  }));

  server.registerTool('get_owner_ledger', {
    title: 'Owner ledger',
    description: 'The director\'s-loan / shareholder current-account net position: total balance per owner (positive = the company owes the owner), and entry count.',
    inputSchema: {},
    annotations: { readOnlyHint: true, title: 'Owner ledger' },
  }, guarded(async () => {
    const { rows: entries } = await fetchAll('ownerLedger');
    const byOwner = {};
    entries.forEach((e) => {
      const key = e.ownerUid || e.ownerName || 'unknown';
      if (!byOwner[key]) byOwner[key] = { owner: e.ownerName || key, balance: 0, entries: 0 };
      byOwner[key].balance = round2(byOwner[key].balance + signedAmount(e));
      byOwner[key].entries += 1;
    });
    return json({ owners: Object.values(byOwner), total_entries: entries.length });
  }));

  server.registerTool('list_revenue_days', {
    title: 'List revenue days',
    description: 'Daily revenue series (ex-VAT) with trip counts (newest first). Filter by month (YYYY-MM) or city.',
    inputSchema: {
      month: z.string().optional().describe('YYYY-MM'),
      city: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional().describe('default 60'),
    },
    annotations: { readOnlyHint: true, title: 'List revenue days' },
  }, guarded(async ({ month, city, limit }) => {
    if (month && !validYm(month)) return errorResult('month must be YYYY-MM');
    const { rows: revenue, truncated } = await fetchAll('revenue', { limit: 6000 });
    const rows = revenue
      .filter((r) => (!month || inMonth(r.date, month)) && (!city || r.city === city || r.location === city))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, limit || 60)
      .map((r) => ({
        date: r.date, city: r.location || r.city || null, revenue_ex_vat: r.totalPaidRevenue ?? null,
        trip_count: r.tripCount ?? null, unique_vehicles: r.uniqueVehiclesCount ?? null,
      }));
    return json({ count: rows.length, ...(truncated ? { truncated: true } : {}), revenue_days: rows });
  }));

  /* ── fleet ────────────────────────────────────────────────────────────── */

  server.registerTool('get_fleet_summary', {
    title: 'Fleet summary',
    description: 'Scooter fleet counts by status and by city, and capital deployed (sum of purchase price).',
    inputSchema: {},
    annotations: { readOnlyHint: true, title: 'Fleet summary' },
  }, guarded(async () => {
    const { rows: scooters } = await fetchAll('scooters');
    const byStatus = {};
    const byCity = {};
    let capitalDeployed = 0;
    scooters.forEach((s) => {
      const status = s.status || 'Unknown';
      byStatus[status] = (byStatus[status] || 0) + 1;
      const city = s.city || 'Unknown';
      byCity[city] = (byCity[city] || 0) + 1;
      capitalDeployed += Number(s.purchasePrice) || 0;
    });
    return json({
      total: scooters.length,
      active: byStatus.Active || 0,
      by_status: byStatus,
      by_city: byCity,
      capital_deployed: round2(capitalDeployed),
    });
  }));

  server.registerTool('list_scooters', {
    title: 'List scooters',
    description: 'Scooter roster: id, model, city, status, purchase date/price. Filter by status (e.g. "Active", "In Repair", "Retired") or city.',
    inputSchema: {
      status: z.string().optional(),
      city: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional().describe('default 50'),
    },
    annotations: { readOnlyHint: true, title: 'List scooters' },
  }, guarded(async ({ status, city, limit }) => {
    const { rows: scooters, truncated } = await fetchAll('scooters');
    const rows = scooters
      .filter((s) => (!status || s.status === status) && (!city || s.city === city))
      .slice(0, limit || 50)
      .map((s) => ({
        id: s.id || s.scooterId, model: s.model || null, city: s.city || null, fleetId: s.fleetId || null,
        status: s.status || null, purchase_date: s.purchaseDate || null, purchase_price: s.purchasePrice ?? null,
      }));
    return json({ count: rows.length, ...(truncated ? { truncated: true } : {}), scooters: rows });
  }));

  /* ── operations ───────────────────────────────────────────────────────── */

  server.registerTool('get_maintenance_summary', {
    title: 'Maintenance summary',
    description: 'Maintenance ticket counts by status, top failure categories, and total labour minutes logged. Optional month (YYYY-MM) filters by the date each ticket was entered.',
    inputSchema: { month: z.string().optional().describe('YYYY-MM; omit for all-time') },
    annotations: { readOnlyHint: true, title: 'Maintenance summary' },
  }, guarded(async ({ month }) => {
    if (month && !validYm(month)) return errorResult('month must be YYYY-MM');
    const { rows: tickets } = await fetchAll('maintenanceTickets');
    const scoped = tickets.filter((t) => !month || inMonth(t.dateEntered, month));
    const byStatus = {};
    const byCategory = {};
    let labourMinutes = 0;
    scoped.forEach((t) => {
      const status = t.status || 'Unknown';
      byStatus[status] = (byStatus[status] || 0) + 1;
      if (t.category) byCategory[t.category] = (byCategory[t.category] || 0) + 1;
      labourMinutes += Number(t.labourMinutes) || 0;
    });
    const topCategories = Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([category, count]) => ({ category, count }));
    return json({
      period: month || 'all-time',
      total: scoped.length,
      active: byStatus.Active || 0,
      by_status: byStatus,
      top_categories: topCategories,
      labour_minutes_logged: labourMinutes,
    });
  }));

  server.registerTool('list_maintenance_tickets', {
    title: 'List maintenance tickets',
    description: 'Maintenance ticket rows (newest first) with parts-used count and labour minutes. Filter by status, scooter, category, or month (YYYY-MM, by date entered).',
    inputSchema: {
      status: z.string().optional(),
      scooterId: z.string().optional(),
      category: z.string().optional(),
      month: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional().describe('default 25'),
    },
    annotations: { readOnlyHint: true, title: 'List maintenance tickets' },
  }, guarded(async ({ status, scooterId, category, month, limit }) => {
    if (month && !validYm(month)) return errorResult('month must be YYYY-MM');
    const { rows: tickets, truncated } = await fetchAll('maintenanceTickets');
    const rows = tickets
      .filter((t) => (!status || t.status === status)
        && (!scooterId || t.scooterId === scooterId)
        && (!category || t.category === category)
        && (!month || inMonth(t.dateEntered, month)))
      .sort((a, b) => String(b.dateEntered || '').localeCompare(String(a.dateEntered || '')))
      .slice(0, limit || 25)
      .map((t) => ({
        id: t.id, scooterId: t.scooterId, category: t.category, status: t.status,
        assignee: t.assignee || null, date_entered: t.dateEntered || null, date_completed: t.dateCompleted || null,
        labour_minutes: t.labourMinutes ?? null, parts_used: Array.isArray(t.partsUsed) ? t.partsUsed.length : 0,
      }));
    return json({ count: rows.length, ...(truncated ? { truncated: true } : {}), tickets: rows });
  }));

  server.registerTool('list_issues', {
    title: 'List issues',
    description: 'Operational issue-tracker rows (newest first). Filter by status ("new"/"snoozed"/"done") or urgency ("low"/"medium"/"high").',
    inputSchema: {
      status: z.string().optional(),
      urgency: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional().describe('default 25'),
    },
    annotations: { readOnlyHint: true, title: 'List issues' },
  }, guarded(async ({ status, urgency, limit }) => {
    const { rows: issues, truncated } = await fetchAll('issues');
    const rows = issues
      .filter((i) => (!status || i.status === status) && (!urgency || i.urgency === urgency))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, limit || 25)
      .map((i) => ({
        id: i._docId, title: i.title, type: i.type || null, status: i.status, urgency: i.urgency || null,
        owner: i.owner || null, due_date: i.dueDate || null, created_at: i.createdAt || null,
      }));
    return json({ count: rows.length, ...(truncated ? { truncated: true } : {}), issues: rows });
  }));

  /* ── projects ─────────────────────────────────────────────────────────── */

  server.registerTool('list_projects', {
    title: 'List projects',
    description: 'Project tracker rows: name, owner, type, category, health ("onTrack"/"needsAttention"/"blocked"), and phase/task progress. Excludes archived projects by default.',
    inputSchema: {
      archived: z.boolean().optional().describe('default false (only non-archived)'),
      limit: z.number().int().min(1).max(100).optional().describe('default 25'),
    },
    annotations: { readOnlyHint: true, title: 'List projects' },
  }, guarded(async ({ archived, limit }) => {
    const { rows: projects, truncated } = await fetchAll('projects');
    const showArchived = archived === true;
    const rows = projects
      .filter((p) => showArchived || !p.archived)
      .slice(0, limit || 25)
      .map((p) => {
        const phases = Array.isArray(p.phases) ? p.phases : [];
        const tasks = phases.flatMap((ph) => (Array.isArray(ph.tasks) ? ph.tasks : []));
        return {
          id: p._docId, name: p.name, owner: p.owner || null, type: p.type || null, category: p.category || null,
          health: p.health || null, start_date: p.startDate || null, target_date: p.targetDate || null,
          archived: !!p.archived, phases_total: phases.length, phases_done: phases.filter((ph) => ph.done).length,
          tasks_total: tasks.length, tasks_done: tasks.filter((t) => t.done).length,
          blockers_open: Array.isArray(p.blockers) ? p.blockers.length : 0,
        };
      });
    return json({ count: rows.length, ...(truncated ? { truncated: true } : {}), projects: rows });
  }));

  /* ── write ────────────────────────────────────────────────────────────── */

  server.registerTool('add_cost', {
    title: 'Add cost',
    description: 'Record a new one-time expense in Omni (EUR). Category must be one of the app\'s categories (e.g. "Fuel", "Parts", "Space rent", "Accounting and Legal services", "Unknown"). Date defaults to today.',
    inputSchema: {
      name: z.string().min(1).max(120),
      amount: z.number().positive(),
      category: z.string().optional().describe('default "Unknown"'),
      date: z.string().optional().describe('YYYY-MM-DD, default today'),
      notes: z.string().max(500).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, title: 'Add cost' },
  }, guarded(async ({ name, amount, category, date, notes }) => {
    if (!supa) return errorResult('Supabase not configured');
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
    const id = globalThis.crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const data = {
      id, name, amount: round2(amount), category: category || 'Unknown', frequency: 'one-time',
      startDate: day, notes: notes || null, source: 'mcp', createdByUid: 'mcp-connector',
      createdAt: nowIso, updatedAt: nowIso,
    };
    const sdid = `${ORG()}_mcp_${day}_${id.slice(0, 8)}`;
    const { error } = await supa.from(SUPABASE_TABLE.costs).insert({ id, org_id: ORG(), source_doc_id: sdid, data });
    if (error) return errorResult(`insert failed: ${error.message}`);
    return json({ ok: true, created: { id, name, amount: data.amount, category: data.category, date: day } });
  }));

  /* ── ChatGPT-connector compatibility pair (also useful lookup tools for Claude) ── */

  server.registerTool('search', {
    title: 'Search records',
    description: 'Search Omni records (costs, loans, issues, projects, scooters, maintenance tickets) by free text. Returns result ids usable with fetch.',
    inputSchema: { query: z.string().min(1) },
    annotations: { readOnlyHint: true, title: 'Search records' },
  }, guarded(async ({ query }) => {
    const [
      { rows: costs }, { rows: loans }, { rows: issues },
      { rows: projects }, { rows: scooters }, { rows: tickets },
    ] = await Promise.all([
      fetchAll('costs'), fetchAll('loans'), fetchAll('issues'),
      fetchAll('projects'), fetchAll('scooters'), fetchAll('maintenanceTickets'),
    ]);
    const q = query.toLowerCase();
    const results = [];
    costs.forEach((c) => {
      if (`${c.name} ${c.notes || ''} ${c.category || ''}`.toLowerCase().includes(q)) {
        results.push({ id: `cost:${c.id}`, title: `${c.startDate ?? '—'} · ${c.name} · €${c.amount} (${c.category})` });
      }
    });
    loans.forEach((l) => {
      if (`${l.name || ''} ${l.loanNumber || ''} ${l.lender || ''}`.toLowerCase().includes(q)) {
        results.push({ id: `loan:${l._docId}`, title: `Loan · ${l.name || l.loanNumber} · balance €${l.currentBalance ?? '?'}` });
      }
    });
    issues.forEach((i) => {
      if (`${i.title || ''} ${i.description || ''}`.toLowerCase().includes(q)) {
        results.push({ id: `issue:${i._docId}`, title: `Issue · ${i.title} (${i.status})` });
      }
    });
    projects.forEach((p) => {
      if (`${p.name || ''} ${p.tagline || ''}`.toLowerCase().includes(q)) {
        results.push({ id: `project:${p._docId}`, title: `Project · ${p.name} (${p.health || 'no status'})` });
      }
    });
    scooters.forEach((s) => {
      const sid = s.id || s.scooterId;
      if (`${sid} ${s.model || ''} ${s.city || ''}`.toLowerCase().includes(q)) {
        results.push({ id: `scooter:${sid}`, title: `Scooter ${sid} · ${s.model || '?'} · ${s.city || '?'} (${s.status})` });
      }
    });
    tickets.forEach((t) => {
      if (`${t.scooterId || ''} ${t.category || ''}`.toLowerCase().includes(q)) {
        results.push({ id: `ticket:${t.id}`, title: `Ticket · ${t.scooterId} · ${t.category} (${t.status})` });
      }
    });
    return json({ results: results.slice(0, 50) });
  }));

  server.registerTool('fetch', {
    title: 'Fetch record',
    description: 'Fetch the full record for an id returned by search (cost:<uuid>, loan:<docId>, issue:<docId>, project:<docId>, scooter:<id>, or ticket:<id>).',
    inputSchema: { id: z.string().min(1) },
    annotations: { readOnlyHint: true, title: 'Fetch record' },
  }, guarded(async ({ id }) => {
    const [kind, ...rest] = id.split(':');
    const key = rest.join(':');
    const byDocId = async (collection) => {
      const { rows } = await fetchAll(collection);
      return rows.find((x) => x._docId === key);
    };
    const byId = async (collection) => {
      const { rows } = await fetchAll(collection);
      return rows.find((x) => (x.id || x.scooterId) === key);
    };
    let record;
    if (kind === 'cost') record = await byId('costs');
    else if (kind === 'loan') record = await byDocId('loans');
    else if (kind === 'issue') record = await byDocId('issues');
    else if (kind === 'project') record = await byDocId('projects');
    else if (kind === 'scooter') record = await byId('scooters');
    else if (kind === 'ticket') record = await byId('maintenanceTickets');
    else return errorResult('id must be cost:<uuid>, loan:<docId>, issue:<docId>, project:<docId>, scooter:<id>, or ticket:<id>');
    return record ? json({ id, record }) : errorResult(`${id} not found`);
  }));

  return server;
}

/* ── auth ───────────────────────────────────────────────────────────────── */
function tokenOk(req) {
  const expected = process.env.MCP_SHARED_TOKEN;
  if (!expected) return false;
  const url = new URL(req.url || '/', 'http://x');
  const given = url.searchParams.get('key')
    || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ── handler (dispatched by api/[...path].js at /api/mcp) ───────────────── */
export default async function mcpHandler(req, res) {
  if (!process.env.MCP_SHARED_TOKEN) {
    res.status(503).json({ error: 'MCP connector not configured (MCP_SHARED_TOKEN unset)' });
    return;
  }
  if (!tokenOk(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (req.method !== 'POST') {
    // Stateless server: no SSE stream, no sessions to DELETE.
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed — POST JSON-RPC only (stateless MCP)' },
      id: null,
    });
    return;
  }
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — fresh per request
      enableJsonResponse: true,
    });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: `Internal error: ${err.message}` },
        id: null,
      });
    }
  }
}
