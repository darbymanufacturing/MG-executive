/**
 * api/intake-wallet.js — pull the bank feed from BudgetBakers Wallet into the
 * Autopilot intake queue (docs/AUTOMATION_PLAN.md §4.1), and keep the company's
 * real cash position current.
 *
 * WHY WALLET AND NOT AN OPEN-BANKING AGGREGATOR: the owner already pays for
 * Wallet Premium with the Alpha Bank account synced, and Omni's 43 cost
 * categories were reverse-engineered from that same Wallet bookkeeping
 * (ADR-0026) — so categories map 1:1 and the owner's existing categorizing in
 * Wallet IS the review step. GoCardless closed to new signups in 2025 and every
 * other EU aggregator is sales-gated; Enable Banking's free own-accounts mode is
 * the documented fallback if Wallet ever goes away.
 *
 * API CONTRACT — taken from the live OpenAPI spec (GET /wallet/openapi, v1.6),
 * not guessed (#703: the first version assumed a numeric `amount` and a `payee`
 * field and silently imported nothing):
 *   GET /v1/api/records  → { records: Record[], nextOffset? }
 *     Record.amount        { value, currencyCode } — NEGATIVE = expense
 *     Record.counterParty  payee (expense) / payer (income)
 *     Record.category      { id, name } — Omni's categories are Wallet's names
 *     Record.transfer      null, or an object for own-account movements
 *     Record.accountId, recordDate, recordType ('expense'|'income'), note
 *     filters: recordDate=gte.YYYY-MM-DD (single bound overrides the default
 *     3-month window), accountId=a,b (max 10), convertTo=EUR, limit ≤ 200, offset
 *   GET /v1/api/accounts → { accounts: Account[], nextOffset? }
 *     Account.balance.currentBalance, accountType, archived, currencyCode
 *   GET /v1/api/standing-orders(/items) → planned payments + their occurrences
 *     (originalDate, paidDate, dismissed; manualPayment=false = a direct debit)
 *
 * Trigger: cron (Authorization: Bearer ${CRON_SECRET}) or an admin manually.
 * Manual runs may pass ?from=YYYY-MM-DD to BACK-FILL history (the first run
 * should: it fills the months before Autopilot existed). Inert until
 * WALLET_API_TOKEN is set: returns 503.
 *
 * Env:
 *   WALLET_API_TOKEN      personal API token (Wallet web → Settings → API; Premium)
 *   WALLET_ACCOUNT_IDS    comma-separated account ids to read. STRONGLY ADVISED:
 *                         the token can see every account in the owner's Wallet,
 *                         including personal ones. Unset = all accounts, which
 *                         is a privacy decision the owner should make explicitly.
 *   WALLET_API_BASE       override (default https://rest.budgetbakers.com/wallet)
 *   WALLET_LOOKBACK_DAYS  how far back a normal run reads (default 45)
 */
import { requireCronOrUser, requireOrgMember } from './_lib/require-auth.js';
import {
  ingestBatch, intakeOrgId, saveAutopilotState, backfillFrom, loadOwners, loadCosts, commitSettlement,
} from './_lib/intake-store.js';
import { supabaseAdmin } from './_lib/supabase-admin.js';
import { ownerForCounterparty, standingOrderCommitments } from '../src/utils/financeRules.js';
import { heartbeatOk, heartbeatFail } from './_lib/heartbeat.js';

const HEARTBEAT_ENV = 'HEARTBEAT_INTAKE_WALLET';
const DEFAULT_BASE = 'https://rest.budgetbakers.com/wallet';
const PAGE_LIMIT = 200;           // documented max
const MAX_PAGES = 40;             // hard stop; 300 req/hour budget
const TIMEOUT_MS = 15000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Account types that hold the company's cash. Cards/loans/overdrafts are debt. */
const CASH_ACCOUNT_TYPES = new Set(['General', 'Cash', 'CurrentAccount', 'SavingAccount']);
const CARD_ACCOUNT_TYPES = new Set(['CreditCard', 'Overdraft']);

const iso = (d) => d.toISOString().slice(0, 10);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

async function walletGet(base, token, path, params) {
  const url = new URL(`${base.replace(/\/$/, '')}${path}`);
  for (const [k, v] of params) url.searchParams.append(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 429) return { rateLimited: true };
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Wallet API ${res.status}: ${body.slice(0, 200)}`);
  }
  return { json: await res.json() };
}

/**
 * Every record dated on/after `fromDate`, newest first, EUR-converted.
 * `accountIds` (≤ 10) narrows the query server-side, so personal accounts are
 * never even downloaded when an allowlist is configured.
 */
export async function fetchWalletRecords({ base, token, fromDate, accountIds = [] }) {
  const out = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = [
      ['limit', String(PAGE_LIMIT)],
      ['offset', String(offset)],
      ['recordDate', `gte.${fromDate}`],
      ['convertTo', 'EUR'],
      ['sortBy', '-recordDate'],
    ];
    if (accountIds.length && accountIds.length <= 10) params.push(['accountId', accountIds.join(',')]);

    const { json, rateLimited } = await walletGet(base, token, '/v1/api/records', params);
    if (rateLimited) { out.rateLimited = true; break; } // token bucket: resume next run
    const batch = Array.isArray(json?.records) ? json.records : [];
    out.push(...batch);
    if (!batch.length || json.nextOffset == null) break;
    offset = json.nextOffset;
  }
  return out;
}

/** All accounts (for balances). */
export async function fetchWalletAccounts({ base, token }) {
  const out = [];
  let offset = 0;
  for (let page = 0; page < 5; page += 1) {
    const { json, rateLimited } = await walletGet(base, token, '/v1/api/accounts', [
      ['limit', String(PAGE_LIMIT)], ['offset', String(offset)],
    ]);
    if (rateLimited) break;
    const batch = Array.isArray(json?.accounts) ? json.accounts : [];
    out.push(...batch);
    if (!batch.length || json.nextOffset == null) break;
    offset = json.nextOffset;
  }
  return out;
}

/** Planned payments ("standing orders") — to tick direct debits Committed. */
export async function fetchStandingOrders({ base, token }) {
  const out = [];
  let offset = 0;
  for (let page = 0; page < 5; page += 1) {
    const { json, rateLimited } = await walletGet(base, token, '/v1/api/standing-orders', [
      ['limit', String(PAGE_LIMIT)], ['offset', String(offset)],
    ]);
    if (rateLimited) break;
    const batch = Array.isArray(json?.standingOrders) ? json.standingOrders : [];
    out.push(...batch);
    if (!batch.length || json.nextOffset == null) break;
    offset = json.nextOffset;
  }
  return out;
}

/** The occurrences of those planned payments due in a window (not dismissed). */
export async function fetchStandingOrderItems({ base, token, from, to }) {
  const out = [];
  let offset = 0;
  for (let page = 0; page < 5; page += 1) {
    const { json, rateLimited } = await walletGet(base, token, '/v1/api/standing-orders/items', [
      ['limit', String(PAGE_LIMIT)], ['offset', String(offset)],
      ['originalDate', `gte.${from}T00:00:00Z`], ['originalDate', `lte.${to}T23:59:59Z`],
      ['dismissed', 'false'],
    ]);
    if (rateLimited) break;
    const batch = Array.isArray(json?.standingOrderItems) ? json.standingOrderItems : [];
    out.push(...batch);
    if (!batch.length || json.nextOffset == null) break;
    offset = json.nextOffset;
  }
  return out;
}

/**
 * The record's amount as a signed EUR number (negative = money out).
 * Prefers the server-side EUR conversion; a foreign-currency record whose
 * conversion failed is reported as not-a-number rather than mis-summed.
 */
export function walletAmountEUR(rec) {
  const conv = rec?.convertedAmount;
  if (conv && !conv.error && conv.currencyCode === 'EUR' && Number.isFinite(Number(conv.value))) {
    return Number(conv.value);
  }
  const a = rec?.amount;
  if (a && typeof a === 'object') {
    if (a.currencyCode && a.currencyCode !== 'EUR') return NaN;
    return Number(a.value);
  }
  return NaN;
}

/** Wallet record → intake raw. Returns null for anything that is not a company cost. */
export function walletRecordToIntake(rec, allowedAccounts) {
  if (!rec || typeof rec !== 'object') return null;

  // Privacy first: with an allowlist configured, a record we cannot place in an
  // allowed account is skipped (fail closed), never imported.
  const accountId = rec.accountId ? String(rec.accountId) : null;
  if (allowedAccounts.size && (!accountId || !allowedAccounts.has(accountId))) return null;

  // Movements between the owner's own accounts (paying the card off, moving
  // cash to savings) are NOT costs — the card purchases already are. Wallet
  // marks them with a `transfer` object; regular records carry null.
  if (rec.transfer) return null;

  const value = walletAmountEUR(rec);
  if (!Number.isFinite(value) || value === 0) return null;

  // Income stays owned by the Hopp/Stripe revenue pipeline — never import
  // credits as revenue here, or every payout is counted twice.
  if (value > 0 || String(rec.recordType || '').toLowerCase() === 'income') return null;

  const category = rec.category?.name || null;
  const payee = String(rec.counterParty || '').trim();

  return {
    sourceRef: String(rec.id || ''),
    kind: 'cost',
    payload: {
      name: payee || String(rec.note || '').trim() || category || 'Bank transaction',
      amount: Math.abs(value),
      date: rec.recordDate || rec.createdAt || null,
      category,
      currency: 'EUR',
      notes: rec.note || null,
      accountId,
    },
    evidence: {
      walletRecordId: rec.id || null,
      accountName: rec.accountName || null,
      recordState: rec.recordState || null,
      bankSynced: rec.accountIsBankSync ?? null,
    },
  };
}

/**
 * Money to or from an OWNER is owner-ledger money (§5: "transfers to/from
 * owners' accounts → drawing/repayment/capital"), held for the owner to confirm:
 *   paid to the owner   → salary payment (switchable to drawing / repayment in Review)
 *   received from them  → capital put in
 * A debit still ALSO imports as a cost when Wallet categorized it (salary is a
 * real cost); the ledger item only records who owes whom. Its own `…_ledger`
 * reference keeps it from colliding with that cost item.
 */
export function walletOwnerMovement(rec, owners, allowedAccounts) {
  if (!rec || typeof rec !== 'object' || rec.transfer) return null;
  const accountId = rec.accountId ? String(rec.accountId) : null;
  if (allowedAccounts.size && (!accountId || !allowedAccounts.has(accountId))) return null;
  const owner = ownerForCounterparty(owners, rec.counterParty);
  if (!owner) return null;
  const value = walletAmountEUR(rec);
  if (!Number.isFinite(value) || value === 0) return null;
  const out = value < 0;
  return {
    sourceRef: `${rec.id}_ledger`,
    kind: 'ledger',
    payload: {
      name: `${out ? 'Paid to' : 'Received from'} ${owner.displayName || 'owner'}`,
      amount: Math.abs(value),
      date: rec.recordDate || null,
      ownerUid: owner._docId,
      ledgerType: out ? 'salary_payment' : 'capital_injection',
      notes: rec.note || null,
    },
    evidence: { walletRecordId: rec.id || null, accountName: rec.accountName || null },
  };
}

/**
 * The company's real cash position from Wallet.
 *   balance      Σ current balance of the (allowed, active) cash accounts
 *   yearOpening  the 1 January balance = balance − every movement since 1 Jan
 *                on those accounts (transfers included: they really moved cash
 *                in or out of these accounts; a move between two of them nets 0)
 *   cards        credit-card / overdraft balances (debt, reported separately)
 * Pure — exported for tests.
 */
export function walletCashPosition(accounts = [], records = [], { allowedAccounts = new Set(), now = new Date() } = {}) {
  const year = now.getUTCFullYear();
  const jan1 = `${year}-01-01`;
  const allowed = (a) => !allowedAccounts.size || allowedAccounts.has(String(a.id));
  const active = accounts.filter((a) => a && !a.archived && allowed(a));

  const cashAccounts = active.filter((a) => CASH_ACCOUNT_TYPES.has(a.accountType)
    && (a.currencyCode || a.balance?.currencyCode || 'EUR') === 'EUR');
  const cashIds = new Set(cashAccounts.map((a) => String(a.id)));

  const balance = round2(cashAccounts.reduce((s, a) => s + (Number(a.balance?.currentBalance) || 0), 0));

  let flow = 0;
  let unconvertible = 0;
  for (const r of records) {
    if (!r || !cashIds.has(String(r.accountId))) continue;
    if (String(r.recordDate || '').slice(0, 10) < jan1) continue;
    const v = walletAmountEUR(r);
    if (Number.isFinite(v)) flow += v; else unconvertible += 1;
  }

  return {
    asOf: now.toISOString(),
    balance,
    yearOpening: { year, amount: round2(balance - flow), netFlowYTD: round2(flow), unconvertible },
    accounts: cashAccounts.map((a) => ({
      id: String(a.id), name: a.name || '', type: a.accountType, balance: round2(Number(a.balance?.currentBalance) || 0),
    })),
    cards: active.filter((a) => CARD_ACCOUNT_TYPES.has(a.accountType)).map((a) => ({
      id: String(a.id), name: a.name || '', type: a.accountType, balance: round2(Number(a.balance?.currentBalance) || 0),
    })),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireCronOrUser(req, res);
  if (!auth) return;
  const orgId = intakeOrgId();
  if (!requireOrgMember(auth, orgId, res)) return;

  const token = process.env.WALLET_API_TOKEN;
  if (!token) {
    return res.status(503).json({
      ok: false,
      error: 'Wallet sync is not configured. Set WALLET_API_TOKEN in Vercel (Wallet web → Settings → API, Premium required).',
    });
  }

  const base = process.env.WALLET_API_BASE || DEFAULT_BASE;
  const lookback = Number(process.env.WALLET_LOOKBACK_DAYS || 45);
  const allowedList = (process.env.WALLET_ACCOUNT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const allowed = new Set(allowedList);

  const now = new Date();
  const backfill = backfillFrom(req.query, auth, now);
  const from = backfill || iso(new Date(now.getTime() - lookback * DAY_MS));
  const jan1 = `${now.getUTCFullYear()}-01-01`;

  try {
    // One read covers both jobs when it already reaches back to 1 January.
    const readFrom = from < jan1 ? from : jan1;
    const records = await fetchWalletRecords({ base, token, fromDate: readFrom, accountIds: allowedList });

    const inWindow = records.filter((r) => String(r.recordDate || '').slice(0, 10) >= from);
    const owners = await loadOwners(supabaseAdmin(), orgId);
    const raws = [
      ...inWindow.map((r) => walletRecordToIntake(r, allowed)),
      ...inWindow.map((r) => walletOwnerMovement(r, owners, allowed)),
    ].filter(Boolean);
    const report = await ingestBatch(raws, { source: 'wallet', orgId, now });

    // Cash position (Planner opening balance + bank-today check). Only trustworthy
    // when the whole year was read — skip it on a rate-limited partial read.
    let cash = null;
    let committed = 0;
    if (!records.rateLimited) {
      const accounts = await fetchWalletAccounts({ base, token });
      cash = walletCashPosition(accounts, records, { allowedAccounts: allowed, now });

      // Direct debits due in the next weeks → their bills' months ticked Committed
      // (ADR-0027), against the costs as they stand after this sync.
      const [orders, items, costsNow] = await Promise.all([
        fetchStandingOrders({ base, token }),
        fetchStandingOrderItems({
          base, token,
          from: iso(new Date(now.getTime() - 5 * DAY_MS)),
          to: iso(new Date(now.getTime() + 35 * DAY_MS)),
        }),
        loadCosts(supabaseAdmin(), orgId),
      ]);
      for (const c of standingOrderCommitments({ orders, items, costs: costsNow, allowedAccounts: allowed, now })) {
        const r = await commitSettlement(supabaseAdmin(), orgId, c.costId, c.period, { status: 'committed', via: 'wallet-standing-order' });
        if (r.settled) committed += 1;
      }
    }
    await saveAutopilotState(orgId, {
      ...(cash ? { walletCash: cash } : {}),
      lastSync: { wallet: { at: now.toISOString(), from, backfill: Boolean(backfill), fetched: records.length, committed, ...report } },
    });

    await heartbeatOk(
      HEARTBEAT_ENV,
      `records=${records.length} auto=${report.auto} held=${report.held} settled=${report.settled}`,
    );
    return res.status(200).json({
      ok: true,
      window: { from, to: iso(now), backfill: Boolean(backfill) },
      fetched: records.length,
      rateLimited: Boolean(records.rateLimited),
      cash: cash ? { balance: cash.balance, yearOpening: cash.yearOpening } : null,
      committed,
      ...report,
    });
  } catch (err) {
    const message = err?.message || String(err);
    console.error('[intake-wallet]', message);
    await heartbeatFail(HEARTBEAT_ENV, message.slice(0, 200));
    return res.status(502).json({ ok: false, error: message });
  }
}
