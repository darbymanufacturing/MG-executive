/**
 * _mcp.js — Omni's remote MCP server (streamable HTTP, stateless), served at
 * POST /api/mcp?key=<MCP_SHARED_TOKEN> via the api/[...path].js catch-all.
 *
 * Lets external AI clients (claude.ai / Claude cowork custom connectors,
 * ChatGPT custom connectors, Claude Code `mcp add --transport http`) read the
 * company's live financial data and add costs. One org (env MCP_ORG_ID,
 * default mg-executive-org); reads use the service-role Supabase client
 * server-side — nothing here is exposed without the shared token.
 *
 * AUTH — capability URL: the token travels as ?key= (or Authorization: Bearer).
 * Consumer connector UIs (claude.ai, ChatGPT) only take a URL, so the token
 * lives in it; treat the full URL as a secret. Rotation = change the
 * MCP_SHARED_TOKEN env var on Vercel and update the URL in the clients.
 * With the env var unset the endpoint answers 503 for everything (safe default).
 *
 * TOOLS (pattern: one tool per action; small surface):
 *   get_financial_summary · list_costs · list_recurring · get_planner_month ·
 *   get_bank_import_status · list_loans · add_cost (write) · search · fetch
 * `search`/`fetch` exist for ChatGPT compatibility (its non-developer-mode
 * connectors require exactly those two tools); Claude simply gets two extra
 * lookup tools.
 *
 * Stateless per-request server: a fresh McpServer + StreamableHTTPServerTransport
 * per POST (sessionIdGenerator: undefined, JSON responses) — the documented
 * serverless pattern; no session affinity needed on Vercel.
 */
import { timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { supabaseAdmin } from './_lib/supabase-admin.js';

const ORG = () => process.env.MCP_ORG_ID || 'mg-executive-org';

/* ── category buckets — mirror src/utils/financialPlanner.js (keep in sync) ── */
const SOFTWARE_CATEGORIES = ['SW subscriptions, Telco charges', 'Operations & computing services', 'App Development Fee'];
const STAFF_CATEGORIES = ['Employees', 'Contractors', 'Payroll Fees'];
const DIVIDEND_CATEGORIES = ['CEO'];
const EXCLUDED_CATEGORIES = ['Transfer, withdraw'];
const LOAN_INTEREST_RE = /^Interest\s+[—-]\s+Loan/;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/* ── data access (service role; org-scoped) ─────────────────────────────── */
async function fetchAll(table, { limit = 3000 } = {}) {
  const supa = supabaseAdmin();
  if (!supa) throw new Error('Supabase admin env vars not configured');
  const rows = [];
  for (let from = 0; from < limit; from += 1000) {
    const { data, error } = await supa
      .from(table)
      .select('source_doc_id,data')
      .eq('org_id', ORG())
      .range(from, Math.min(from + 999, limit - 1));
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows.map((r) => ({ _docId: r.source_doc_id, ...(r.data || {}) }));
}

const inMonth = (dateStr, ym) => typeof dateStr === 'string' && dateStr.startsWith(ym);
const validYm = (ym) => /^\d{4}-(0[1-9]|1[0-2])$/.test(ym);

function json(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 1) }] };
}

/* ── the server ─────────────────────────────────────────────────────────── */
function buildServer() {
  const server = new McpServer(
    { name: 'omni-fleet-finance', version: '1.0.0' },
    {
      instructions:
        'Omni is a Greek micromobility (e-scooter rental) company. All amounts are EUR. '
        + 'Cost rows are cash records (bank/wallet imports + manual entries); revenue rows are daily per-city trip revenue stored ex-VAT. '
        + 'Categories follow the owner\'s bookkeeping (43 categories); "Transfer, withdraw" rows are internal money movements, not expenses. '
        + 'Use get_financial_summary for headline numbers, get_planner_month for a month\'s planner sheet, list_costs to inspect entries.',
    },
  );

  server.registerTool('get_financial_summary', {
    description: 'Headline financials for a month (YYYY-MM) or all time: revenue (ex-VAT), cash costs (dated cost rows; internal transfers excluded), net, dividends (owner draw), plus counts.',
    inputSchema: { month: z.string().optional().describe('YYYY-MM; omit for all-time') },
  }, async ({ month }) => {
    if (month && !validYm(month)) return json({ error: 'month must be YYYY-MM' });
    const [costs, revenue] = await Promise.all([fetchAll('costs'), fetchAll('revenue', { limit: 6000 })]);
    const inScope = (c) => (!month || inMonth(c.startDate, month));
    const costRows = costs.filter((c) => c.frequency === 'one-time' && inScope(c) && !LOAN_INTEREST_RE.test(c.name || ''));
    const spent = costRows.filter((c) => !EXCLUDED_CATEGORIES.includes(c.category) && !DIVIDEND_CATEGORIES.includes(c.category));
    const dividends = costRows.filter((c) => DIVIDEND_CATEGORIES.includes(c.category));
    const transfers = costRows.filter((c) => EXCLUDED_CATEGORIES.includes(c.category));
    const revRows = revenue.filter((r) => (!month || inMonth(r.date, month)));
    const revTotal = round2(revRows.reduce((s, r) => s + (Number(r.totalPaidRevenue) || 0), 0));
    const costTotal = round2(spent.reduce((s, c) => s + (Number(c.amount) || 0), 0));
    return json({
      period: month || 'all-time',
      revenue_ex_vat: revTotal,
      cash_costs: costTotal,
      net_cash_flow: round2(revTotal - costTotal),
      dividends_owner_draw: round2(dividends.reduce((s, c) => s + (Number(c.amount) || 0), 0)),
      internal_transfers_excluded: round2(transfers.reduce((s, c) => s + (Number(c.amount) || 0), 0)),
      cost_entries: spent.length,
      revenue_days: new Set(revRows.map((r) => r.date)).size,
      note: 'Cash view: dated one-time cost rows only; recurring commitments are in list_recurring. Loan-interest P&L split rows excluded (the bank debits carry the cash).',
    });
  });

  server.registerTool('list_costs', {
    description: 'List cost entries (newest first). Filter by month (YYYY-MM), category (exact, e.g. "Fuel", "VAT", "Bank loans"), or free-text query on name/notes.',
    inputSchema: {
      month: z.string().optional(),
      category: z.string().optional(),
      query: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional().describe('default 25'),
    },
  }, async ({ month, category, query, limit }) => {
    if (month && !validYm(month)) return json({ error: 'month must be YYYY-MM' });
    const costs = await fetchAll('costs');
    const q = (query || '').toLowerCase();
    const rows = costs
      .filter((c) => (!month || inMonth(c.startDate, month))
        && (!category || c.category === category)
        && (!q || `${c.name} ${c.notes || ''}`.toLowerCase().includes(q)))
      .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')))
      .slice(0, limit || 25)
      .map((c) => ({ id: c.id, date: c.startDate, name: c.name, amount: c.amount, category: c.category, frequency: c.frequency, location: c.location || null, source: c.source || 'manual' }));
    return json({ count: rows.length, costs: rows });
  });

  server.registerTool('list_recurring', {
    description: 'The standing recurring commitments (rent, subscriptions, loan instalments, wages) with per-month equivalents — the forward run-rate, separate from dated cash entries.',
    inputSchema: {},
  }, async () => {
    const costs = await fetchAll('costs');
    const MULT = { monthly: 1, quarterly: 1 / 3, annual: 1 / 12, yearly: 1 / 12, weekly: 52 / 12, daily: 365 / 12 };
    const rec = costs.filter((c) => c.frequency && c.frequency !== 'one-time'
      && !(c.endDate && c.endDate < new Date().toISOString().slice(0, 10)));
    const items = rec.map((c) => ({
      name: c.name, category: c.category, frequency: c.frequency, amount: c.amount,
      monthly_equivalent: round2((Number(c.amount) || 0) * (MULT[c.frequency] || 0)),
    })).sort((a, b) => b.monthly_equivalent - a.monthly_equivalent);
    return json({ count: items.length, monthly_run_rate: round2(items.reduce((s, i) => s + i.monthly_equivalent, 0)), commitments: items });
  });

  server.registerTool('get_planner_month', {
    description: 'One month of the Financial Planner (cash view): revenue by city, expenses bucketed Software/Staff/Others, dividends (owner draw), and the summary line (revenue, expenses, net). Month = YYYY-MM.',
    inputSchema: { month: z.string().describe('YYYY-MM') },
  }, async ({ month }) => {
    if (!validYm(month)) return json({ error: 'month must be YYYY-MM' });
    const [costs, revenue] = await Promise.all([fetchAll('costs'), fetchAll('revenue', { limit: 6000 })]);
    const revByCity = {};
    revenue.filter((r) => inMonth(r.date, month)).forEach((r) => {
      const city = r.location || r.city || 'Unknown';
      revByCity[city] = round2((revByCity[city] || 0) + (Number(r.totalPaidRevenue) || 0));
    });
    const buckets = { software: [], staff: [], others: [] };
    const dividends = [];
    costs.filter((c) => c.frequency === 'one-time' && inMonth(c.startDate, month)).forEach((c) => {
      if (EXCLUDED_CATEGORIES.includes(c.category) || LOAN_INTEREST_RE.test(c.name || '')) return;
      const item = { name: c.name, amount: c.amount, category: c.category, date: c.startDate };
      if (DIVIDEND_CATEGORIES.includes(c.category)) dividends.push(item);
      else if (SOFTWARE_CATEGORIES.includes(c.category)) buckets.software.push(item);
      else if (STAFF_CATEGORIES.includes(c.category)) buckets.staff.push(item);
      else buckets.others.push(item);
    });
    const sum = (arr) => round2(arr.reduce((s, i) => s + (Number(i.amount) || 0), 0));
    const totals = { revenue: round2(Object.values(revByCity).reduce((s, v) => s + v, 0)), software: sum(buckets.software), staff: sum(buckets.staff), others: sum(buckets.others), dividends: sum(dividends) };
    totals.expenses = round2(totals.software + totals.staff + totals.others);
    totals.net_cash_flow = round2(totals.revenue - totals.expenses);
    return json({ month, revenue_by_city: revByCity, expense_buckets: buckets, dividends, totals });
  });

  server.registerTool('get_bank_import_status', {
    description: 'How current the imported bank data is: latest transaction date, covered range, and the date the next Alpha Bank CSV export should start from.',
    inputSchema: {},
  }, async () => {
    const costs = await fetchAll('costs');
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
  });

  server.registerTool('list_loans', {
    description: 'All tracked debts (bank loans and credit cards): balances, payments logged, latest activity.',
    inputSchema: {},
  }, async () => {
    const loans = await fetchAll('loans');
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
  });

  server.registerTool('add_cost', {
    description: 'Record a new one-time expense in Omni (EUR). Category must be one of the app\'s categories (e.g. "Fuel", "Parts", "Space rent", "Accounting and Legal services", "Unknown"). Date defaults to today.',
    inputSchema: {
      name: z.string().min(1).max(120),
      amount: z.number().positive(),
      category: z.string().optional().describe('default "Unknown"'),
      date: z.string().optional().describe('YYYY-MM-DD, default today'),
      notes: z.string().max(500).optional(),
    },
  }, async ({ name, amount, category, date, notes }) => {
    const supa = supabaseAdmin();
    if (!supa) return json({ error: 'Supabase not configured' });
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
    const id = globalThis.crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const data = {
      id, name, amount: round2(amount), category: category || 'Unknown', frequency: 'one-time',
      startDate: day, notes: notes || null, source: 'mcp', createdByUid: 'mcp-connector',
      createdAt: nowIso, updatedAt: nowIso,
    };
    const sdid = `${ORG()}_mcp_${day}_${id.slice(0, 8)}`;
    const { error } = await supa.from('costs').insert({ id, org_id: ORG(), source_doc_id: sdid, data });
    if (error) return json({ error: `insert failed: ${error.message}` });
    return json({ ok: true, created: { id, name, amount: data.amount, category: data.category, date: day } });
  });

  /* ── ChatGPT-connector compatibility pair ── */
  server.registerTool('search', {
    description: 'Search Omni financial records (costs and loans) by free text. Returns result ids usable with fetch.',
    inputSchema: { query: z.string().min(1) },
  }, async ({ query }) => {
    const [costs, loans] = await Promise.all([fetchAll('costs'), fetchAll('loans')]);
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
    return json({ results: results.slice(0, 50) });
  });

  server.registerTool('fetch', {
    description: 'Fetch the full record for an id returned by search (cost:<uuid> or loan:<docId>).',
    inputSchema: { id: z.string().min(1) },
  }, async ({ id }) => {
    const [kind, ...rest] = id.split(':');
    const key = rest.join(':');
    if (kind === 'cost') {
      const costs = await fetchAll('costs');
      const c = costs.find((x) => x.id === key);
      return json(c ? { id, record: c } : { error: 'not found' });
    }
    if (kind === 'loan') {
      const loans = await fetchAll('loans');
      const l = loans.find((x) => x._docId === key);
      return json(l ? { id, record: l } : { error: 'not found' });
    }
    return json({ error: 'id must be cost:<uuid> or loan:<docId>' });
  });

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
