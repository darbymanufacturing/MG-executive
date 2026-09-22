/**
 * intake.js — the brain of Omni Autopilot Phase 1 (docs/AUTOMATION_PLAN.md §3).
 *
 * Every automatic source (Wallet bank feed, AADE myDATA, the Gmail invoice
 * watcher, WhatsApp captures, Hopp CSV drops, internal rules) produces INTAKE
 * ITEMS. This module is the pure, shared decision layer over them:
 *
 *   normalizeIntakeItem()  — one canonical shape, whatever the source
 *   matchIntakeItem()      — is this a duplicate / a known bill / an invoice payment?
 *   classifyIntake()       — auto-commit, or hold for the owner?
 *
 * Pure on purpose (no Supabase, no React, no fetch): the serverless ingest
 * endpoints and the client Review page both import it, so the rules can never
 * drift between "what the robot did" and "what the UI explains".
 *
 * OWNER POLICY (Kostas, 2026-09-22): unsure items are HELD for approval. The
 * gate below is deliberately conservative — anything touching the owner ledger
 * or a loan balance is always held, no matter how confident the source is.
 */
import { cleanMerchantName, categorizationText } from './normalizeGreekLatin.js';
import { isCommitment } from './upcomingPayments.js';

export const INTAKE_SOURCES = Object.freeze([
  'wallet', 'mydata', 'gmail', 'whatsapp', 'hopp_csv', 'rule',
]);

export const INTAKE_KINDS = Object.freeze([
  'cost', 'revenue_import', 'ledger', 'loan_payment',
  'ticket', 'parts_receipt', 'issue', 'task',
]);

export const INTAKE_STATUSES = Object.freeze([
  'pending', 'auto_committed', 'approved', 'rejected', 'merged',
]);

/** Kinds that ALWAYS need a human, however confident the source is. */
export const ALWAYS_HELD_KINDS = Object.freeze(['ledger', 'loan_payment']);

/** Categories that mean "we don't actually know what this is". */
const UNKNOWN_CATEGORIES = new Set(['Unknown', 'unknown', 'Other', 'Others', '']);

const DAY_MS = 24 * 60 * 60 * 1000;

/* ── helpers ─────────────────────────────────────────────────────────────── */

const toNumber = (v) => {
  const n = Number(typeof v === 'string' ? v.replace(',', '.') : v);
  return Number.isFinite(n) ? n : 0;
};

const toISODate = (v) => {
  if (!v) return null;
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

const daysBetween = (a, b) => {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return Infinity;
  return Math.round((db - da) / DAY_MS);
};

/** Comparable payee key: Greek/Latin lookalikes folded, punctuation dropped. */
export function payeeKey(name) {
  if (!name) return '';
  return categorizationText(cleanMerchantName(String(name)))
    .replace(/[^a-z0-9α-ω ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Do two payee strings plausibly name the same counterparty? */
export function payeesMatch(a, b) {
  const ka = payeeKey(a);
  const kb = payeeKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;

  // Spacing is noise on Greek company suffixes: "JYSK A.E." vs "JYSK AE" is the
  // same supplier, and bank feeds spell these inconsistently.
  const ca = ka.replace(/ /g, '');
  const cb = kb.replace(/ /g, '');
  if (ca === cb) return true;

  // One contains the other ("starlink" vs "starlink internet corinth").
  const [short, long] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
  return short.length >= 4 && long.includes(short);
}

/** Amounts equal within a relative tolerance (default 2%) or 1 cent. */
export function amountsMatch(a, b, tolerancePct = 0.02) {
  const x = Math.abs(toNumber(a));
  const y = Math.abs(toNumber(b));
  if (x === 0 || y === 0) return x === y;
  return Math.abs(x - y) <= Math.max(0.01, Math.max(x, y) * tolerancePct);
}

/* ── normalize ───────────────────────────────────────────────────────────── */

/**
 * Bring any source's raw record into the canonical intake shape.
 * Never throws: bad input becomes an item the gate will hold.
 */
export function normalizeIntakeItem(raw = {}, { now = new Date() } = {}) {
  const source = INTAKE_SOURCES.includes(raw.source) ? raw.source : 'rule';
  const kind = INTAKE_KINDS.includes(raw.kind) ? raw.kind : 'cost';
  const payload = raw.payload || {};
  const nowIso = now.toISOString();

  return {
    source,
    sourceRef: String(raw.sourceRef ?? '').trim(),
    kind,
    payload: {
      ...payload,
      name: payload.name ? String(payload.name).trim() : '',
      amount: toNumber(payload.amount),
      date: toISODate(payload.date) || toISODate(nowIso),
      category: payload.category ?? null,
      vatAmount: payload.vatAmount == null ? null : toNumber(payload.vatAmount),
      currency: payload.currency || 'EUR',
    },
    evidence: raw.evidence || {},
    confidence: 0,
    reasons: [],
    match: null,
    status: 'pending',
    committedRef: null,
    decidedAt: null,
    decidedBy: null,
    createdAt: raw.createdAt || nowIso,
    updatedAt: nowIso,
  };
}

/* ── match ───────────────────────────────────────────────────────────────── */

/**
 * Find what this item refers to among existing costs.
 *
 * One real-world cost can reach Omni four ways (myDATA invoice, emailed PDF,
 * receipt photo, bank debit). Matching is what keeps that ONE cost instead of
 * four, and what lets a bank debit tick an existing bill as Paid rather than
 * adding a second row.
 *
 * @returns {null|{type:'duplicate'|'commitment'|'invoice_payment', targetId, score, why}}
 */
export function matchIntakeItem(item, costs = [], { now = new Date(), paymentWindowDays = 60 } = {}) {
  if (!item || item.kind !== 'cost') return null;
  const { payload = {} } = item;
  const list = Array.isArray(costs) ? costs : [];

  // 1. Same source record already imported → this IS that row.
  const sameRef = list.find(
    (c) => c._intakeRef && item.sourceRef && c._intakeRef === `${item.source}:${item.sourceRef}`,
  );
  if (sameRef) {
    return { type: 'duplicate', targetId: sameRef.id, score: 1, why: 'Already imported from this source' };
  }

  // 2. Same payee + amount + date → a duplicate seen through another source.
  const dup = list.find(
    (c) => c.startDate === payload.date
      && amountsMatch(c.amount, payload.amount, 0.005)
      && payeesMatch(c.name, payload.name),
  );
  if (dup) {
    return { type: 'duplicate', targetId: dup.id, score: 0.95, why: 'Same payee, amount and date as an existing cost' };
  }

  // 3. A recurring commitment this debit pays (→ tick the month Paid, don't add).
  const commitment = list.find(
    (c) => isCommitment(c, { now })
      && payeesMatch(c.name, payload.name)
      && amountsMatch(c.amount, payload.amount),
  );
  if (commitment) {
    return {
      type: 'commitment',
      targetId: commitment.id,
      score: 0.9,
      why: `Matches the recurring bill "${commitment.name}"`,
    };
  }

  // 4. A one-time cost (e.g. a myDATA invoice) this debit settles later.
  const invoice = list.find((c) => {
    if (c.frequency && c.frequency !== 'one-time') return false;
    if (!payeesMatch(c.name, payload.name)) return false;
    if (!amountsMatch(c.amount, payload.amount)) return false;
    const gap = daysBetween(c.startDate, payload.date);
    return gap >= 0 && gap <= paymentWindowDays;
  });
  if (invoice) {
    return {
      type: 'invoice_payment',
      targetId: invoice.id,
      score: 0.85,
      why: `Looks like payment of "${invoice.name}"`,
    };
  }

  return null;
}

/* ── classify ────────────────────────────────────────────────────────────── */

/**
 * Decide: commit automatically, or hold for the owner?
 *
 * @param {object} item     normalized intake item (optionally with .match set)
 * @param {object} ctx
 * @param {boolean} [ctx.trustWalletCategories=true]  owner switch
 * @param {Set<string>|string[]} [ctx.knownSuppliers]  payee keys with a learned rule
 * @returns {{decision:'auto'|'hold', confidence:number, reasons:string[]}}
 */
export function classifyIntake(item, ctx = {}) {
  const reasons = [];
  if (!item) return { decision: 'hold', confidence: 0, reasons: ['No item'] };

  const { trustWalletCategories = true } = ctx;
  const knownSuppliers = ctx.knownSuppliers instanceof Set
    ? ctx.knownSuppliers
    : new Set(ctx.knownSuppliers || []);

  const { payload = {}, match } = item;

  // Hard holds first — these outrank every confidence signal.
  if (ALWAYS_HELD_KINDS.includes(item.kind)) {
    return {
      decision: 'hold',
      confidence: 0.5,
      reasons: ['Money between the owners and the company is always reviewed'],
    };
  }
  if (!payload.amount || payload.amount <= 0) {
    return { decision: 'hold', confidence: 0, reasons: ['No usable amount'] };
  }
  if (!payload.name) {
    return { decision: 'hold', confidence: 0.2, reasons: ['No payee name'] };
  }

  // A duplicate is merged, not re-added — safe to do without asking.
  if (match?.type === 'duplicate') {
    return { decision: 'auto', confidence: 0.99, reasons: [match.why] };
  }

  // A debit that pays a bill we already know about: tick it, don't add a cost.
  if (match?.type === 'commitment' || match?.type === 'invoice_payment') {
    reasons.push(match.why);
    return { decision: 'auto', confidence: match.score, reasons };
  }

  // Wallet items the owner already categorized in Wallet — that WAS the review.
  if (item.source === 'wallet') {
    const hasCategory = payload.category && !UNKNOWN_CATEGORIES.has(String(payload.category));
    if (hasCategory && trustWalletCategories) {
      reasons.push(`Categorized in Wallet as "${payload.category}"`);
      return { decision: 'auto', confidence: 0.9, reasons };
    }
    reasons.push(hasCategory
      ? 'Wallet categories are set to be double-checked'
      : 'Wallet left this uncategorized');
    return { decision: 'hold', confidence: 0.4, reasons };
  }

  // A supplier with a learned rule (taught by an earlier approval).
  if (knownSuppliers.has(payeeKey(payload.name))) {
    reasons.push('Known supplier with a saved rule');
    return { decision: 'auto', confidence: 0.85, reasons };
  }

  reasons.push(item.source === 'mydata' ? 'New supplier invoice' : 'New payee — first time seen');
  return { decision: 'hold', confidence: 0.35, reasons };
}

/**
 * Run the whole pipeline for one raw record.
 * Returns the item ready to store, with match + gate applied.
 */
export function prepareIntakeItem(raw, costs = [], ctx = {}) {
  const item = normalizeIntakeItem(raw, ctx);
  item.match = matchIntakeItem(item, costs, ctx);
  const { decision, confidence, reasons } = classifyIntake(item, ctx);
  item.confidence = confidence;
  item.reasons = reasons;
  item.status = decision === 'auto' ? 'auto_committed' : 'pending';
  return item;
}
