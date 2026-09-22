/**
 * api/intake-wallet.js — pull the bank feed from BudgetBakers Wallet into the
 * Autopilot intake queue (docs/AUTOMATION_PLAN.md §4.1).
 *
 * WHY WALLET AND NOT AN OPEN-BANKING AGGREGATOR: the owner already pays for
 * Wallet Premium with the Alpha Bank account synced, and Omni's 43 cost
 * categories were reverse-engineered from that same Wallet bookkeeping
 * (ADR-0026) — so categories map 1:1 and the owner's existing categorizing in
 * Wallet IS the review step. GoCardless closed to new signups in 2025 and every
 * other EU aggregator is sales-gated; Enable Banking's free own-accounts mode is
 * the documented fallback if Wallet ever goes away.
 *
 * Trigger: cron / GitHub Actions (Authorization: Bearer ${CRON_SECRET}) or an
 * admin hitting it manually. Inert until WALLET_API_TOKEN is set: returns 503,
 * exactly like the MCP connector did before its token existed.
 *
 * Env:
 *   WALLET_API_TOKEN      personal API token (Wallet web → Settings → API; Premium)
 *   WALLET_ACCOUNT_IDS    comma-separated account ids to read. STRONGLY ADVISED:
 *                         the token can see every account in the owner's Wallet,
 *                         including personal ones. Unset = all accounts, which
 *                         is a privacy decision the owner should make explicitly.
 *   WALLET_API_BASE       override (default https://rest.budgetbakers.com/wallet)
 *   WALLET_LOOKBACK_DAYS  how far back to pull each run (default 45)
 */
import { requireCronOrUser } from './_lib/require-auth.js';
import { ingestBatch } from './_lib/intake-store.js';
import { heartbeatOk, heartbeatFail } from './_lib/heartbeat.js';

const HEARTBEAT_ENV = 'HEARTBEAT_INTAKE_WALLET';
const DEFAULT_BASE = 'https://rest.budgetbakers.com/wallet';
const PAGE_LIMIT = 200;           // documented max
const MAX_PAGES = 25;             // hard stop; 300 req/hour budget
const TIMEOUT_MS = 15000;

const iso = (d) => d.toISOString().slice(0, 10);

/**
 * Fetch records, newest first, over a date window.
 * Wallet's filter syntax is `field=gte.value` / `lte.`; the response is either
 * a bare array or `{ items|records|data: [...] , nextOffset }` depending on
 * endpoint version, so accept all shapes rather than guessing one.
 */
async function fetchWalletRecords({ base, token, fromDate, toDate }) {
  const out = [];
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`${base.replace(/\/$/, '')}/v1/api/records`);
    url.searchParams.set('limit', String(PAGE_LIMIT));
    url.searchParams.set('offset', String(offset));
    url.searchParams.append('recordDate', `gte.${fromDate}`);
    url.searchParams.append('recordDate', `lte.${toDate}`);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 429) {
      // Token-bucket limit (300/hour). Stop cleanly; the next run resumes.
      out.rateLimited = true;
      break;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Wallet API ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = await res.json();
    const batch = Array.isArray(json)
      ? json
      : (json.items || json.records || json.data || []);
    out.push(...batch);

    const next = Array.isArray(json) ? null : json.nextOffset;
    if (!batch.length || next == null) break;
    offset = next;
  }
  return out;
}

/** Wallet record → intake raw. Returns null for things that are not costs. */
export function walletRecordToIntake(rec, allowedAccounts) {
  if (!rec || typeof rec !== 'object') return null;

  const accountId = rec.account?.id || rec.accountId || rec.account || null;
  if (allowedAccounts.size && accountId && !allowedAccounts.has(String(accountId))) return null;

  // Transfers between the owner's own accounts (e.g. paying the credit card off)
  // are NOT costs — the card purchases already are. Counting both double-counts.
  const type = String(rec.type || rec.recordType || '').toLowerCase();
  if (rec.transfer === true || type === 'transfer') return null;

  const rawAmount = Number(rec.amount ?? rec.value ?? 0);
  if (!Number.isFinite(rawAmount) || rawAmount === 0) return null;

  // Income stays owned by the Hopp/Stripe revenue pipeline — never import credits
  // as revenue here, or every payout gets counted twice.
  const isExpense = type === 'expense' || rawAmount < 0;
  if (!isExpense) return null;

  const category = rec.category?.name || rec.categoryName
    || (typeof rec.category === 'string' ? rec.category : null);

  return {
    sourceRef: String(rec.id || rec.recordId || ''),
    kind: 'cost',
    payload: {
      name: rec.payee || rec.note || category || 'Bank transaction',
      amount: Math.abs(rawAmount),
      date: rec.recordDate || rec.date || rec.createdAt,
      category: category || null,
      currency: rec.currency || 'EUR',
      notes: rec.note || null,
      accountId,
    },
    evidence: { walletRecordId: rec.id, paymentType: rec.paymentType || null },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireCronOrUser(req, res);
  if (!auth) return;

  const token = process.env.WALLET_API_TOKEN;
  if (!token) {
    return res.status(503).json({
      ok: false,
      error: 'Wallet sync is not configured. Set WALLET_API_TOKEN in Vercel (Wallet web → Settings → API, Premium required).',
    });
  }

  const base = process.env.WALLET_API_BASE || DEFAULT_BASE;
  const lookback = Number(process.env.WALLET_LOOKBACK_DAYS || 45);
  const allowed = new Set(
    (process.env.WALLET_ACCOUNT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  );

  const to = new Date();
  const from = new Date(to.getTime() - lookback * 24 * 60 * 60 * 1000);

  try {
    const records = await fetchWalletRecords({
      base, token, fromDate: iso(from), toDate: iso(to),
    });

    const raws = records.map((r) => walletRecordToIntake(r, allowed)).filter(Boolean);
    const report = await ingestBatch(raws, { source: 'wallet' });

    await heartbeatOk(
      HEARTBEAT_ENV,
      `records=${records.length} auto=${report.auto} held=${report.held} settled=${report.settled}`,
    );
    return res.status(200).json({ ok: true, window: { from: iso(from), to: iso(to) }, fetched: records.length, ...report });
  } catch (err) {
    const message = err?.message || String(err);
    console.error('[intake-wallet]', message);
    await heartbeatFail(HEARTBEAT_ENV, message.slice(0, 200));
    return res.status(502).json({ ok: false, error: message });
  }
}
