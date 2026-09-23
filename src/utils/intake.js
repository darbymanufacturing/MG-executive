/**
 * intake.js — the brain of Omni Autopilot (docs/AUTOMATION_PLAN.md §3).
 *
 * Every automatic source (Wallet bank feed, AADE myDATA, the Gmail invoice
 * watcher, WhatsApp captures, Hopp CSV drops, internal rules) produces INTAKE
 * ITEMS. This module is the pure, shared decision layer over them:
 *
 *   normalizeIntakeItem()  — one canonical shape, whatever the source
 *   applyLearnedRules()    — fill the supplier/category an earlier approval taught us
 *   matchIntakeItem()      — is this a duplicate / a known bill / an invoice payment?
 *   classifyIntake()       — auto-commit, or hold for the owner?
 *
 * Pure on purpose (no Supabase, no React, no fetch): the serverless ingest
 * endpoints and the client Review page both import it, so the rules can never
 * drift between "what the robot did" and "what the UI explains".
 *
 * OWNER POLICY (Kostas, 2026-09-22): unsure items are HELD for approval. The
 * gate below is deliberately conservative — anything touching the owner ledger
 * or a loan balance is always held, no matter how confident the source is, and
 * money is never auto-committed without a real category.
 */
import { cleanMerchantName, categorizationText } from './normalizeGreekLatin.js';
import { isCommitment, settlementPeriodFor } from './upcomingPayments.js';
import { CATEGORIES } from './constants.js';
import { inferCategoryFromText } from './bankRulesEngine.js';

export const INTAKE_SOURCES = Object.freeze([
  'wallet', 'mydata', 'gmail', 'whatsapp', 'hopp_csv', 'rule', 'capture',
]);

export const INTAKE_KINDS = Object.freeze([
  'cost', 'revenue_import', 'ledger', 'loan_payment',
  'ticket', 'parts_receipt', 'issue', 'task', 'recurring',
]);

export const INTAKE_STATUSES = Object.freeze([
  'pending', 'auto_committed', 'approved', 'rejected', 'merged',
]);

/** Kinds that ALWAYS need a human, however confident the source is. */
export const ALWAYS_HELD_KINDS = Object.freeze(['ledger', 'loan_payment', 'recurring']);

/** Kinds that are money: they must never auto-commit without a real category. */
const MONEY_KINDS = new Set(['cost']);

/** Sources that report a PAYMENT (money left the account), not a document. */
const PAYMENT_SOURCES = new Set(['wallet']);

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

/* ── categories ──────────────────────────────────────────────────────────── */

const CATEGORY_BY_LOWER = (() => {
  const map = new Map();
  for (const [key, def] of Object.entries(CATEGORIES)) {
    map.set(key.toLowerCase(), key);
    if (def?.label) map.set(String(def.label).toLowerCase(), key);
  }
  return map;
})();

/** Words that mean "we don't know" — in Omni and in Wallet's system categories. */
const NOT_A_CATEGORY = new Set([
  '', 'unknown', 'unknown expense', 'unknown income', 'uncategorized', 'other', 'others', 'missing',
]);

/**
 * Turn any category guess into one of Omni's category KEYS, or null.
 * Sources speak different vocabularies: Wallet uses Omni's own names
 * (ADR-0026), the invoice extractor and the WhatsApp router return plain
 * language ("Petrol", "Office rent"). A guess that isn't a real key must never
 * reach a cost row — it would look categorized while matching no category.
 */
export function canonicalCategory(guess) {
  if (guess == null) return null;
  const s = String(guess).trim();
  if (NOT_A_CATEGORY.has(s.toLowerCase())) return null;
  const exact = CATEGORY_BY_LOWER.get(s.toLowerCase());
  if (exact) return exact === 'Unknown' ? null : exact;
  // Plain-language guesses → the same keyword rules the bank import uses.
  const { category, matched } = inferCategoryFromText(s);
  return matched ? category : null;
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
  const category = canonicalCategory(payload.category);

  return {
    source,
    sourceRef: String(raw.sourceRef ?? '').trim(),
    kind,
    payload: {
      ...payload,
      name: payload.name ? String(payload.name).trim() : '',
      amount: toNumber(payload.amount),
      date: toISODate(payload.date) || toISODate(nowIso),
      category,
      ...(payload.category && payload.category !== category ? { categoryGuess: String(payload.category) } : {}),
      vatAmount: payload.vatAmount == null ? null : toNumber(payload.vatAmount),
      currency: payload.currency || 'EUR',
    },
    evidence: raw.evidence || {},
    confidence: 0,
    reasons: [],
    match: null,
    rule: null,
    status: 'pending',
    committedRef: null,
    decidedAt: null,
    decidedBy: null,
    createdAt: raw.createdAt || nowIso,
    updatedAt: nowIso,
    // A source can insist on a human (e.g. mail from a sender not on the
    // trusted list): the gate then holds it whatever else is known.
    ...(raw.holdReason ? { noAuto: true, holdReason: String(raw.holdReason) } : {}),
  };
}

/* ── learned rules ───────────────────────────────────────────────────────── */

/** Is this a rule an approval taught (vs one the owner typed on the Rules page)? */
const isLearned = (r) => r?.learned === true;

/**
 * The supplier name + category earlier decisions taught us, for an item whose
 * source didn't say. Checked in order of certainty:
 *   1. ΑΦΜ rule      — myDATA invoices carry only the supplier's VAT number
 *   2. learned payee — "JYSK" was approved as Space & Equipment before
 *   3. owner rule    — a keyword rule typed on the Bank Import → Rules page
 *   4. history       — the latest categorized cost from the same payee
 * The bank import's built-in keyword DEFAULTS are deliberately not used: they
 * are guesses, and a guess must never auto-commit money.
 *
 * @returns {null | { category, name?, via }}
 */
export function applyLearnedRules(item, { rules = [], costs = [] } = {}) {
  if (!item || !MONEY_KINDS.has(item.kind)) return null;
  const p = item.payload || {};
  const list = Array.isArray(rules) ? rules : [];

  const vat = String(p.counterpartVat || '').replace(/\D/g, '');
  if (vat) {
    const r = list.find((x) => x?.vatNumber && String(x.vatNumber).replace(/\D/g, '') === vat && x.category);
    if (r) return { category: canonicalCategory(r.category), name: r.supplierName || null, via: 'Supplier ΑΦΜ rule' };
  }

  if (!p.name) return null;

  const learned = list.find((x) => isLearned(x) && x.category && (x.supplierName || x.contains)
    && payeesMatch(x.supplierName || x.contains, p.name));
  if (learned) return { category: canonicalCategory(learned.category), via: 'Learned from an earlier approval' };

  const haystack = categorizationText(p.name);
  const owner = [...list]
    .filter((x) => !isLearned(x) && x.contains && x.category)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
    .find((x) => haystack.includes(String(x.contains).toUpperCase()));
  if (owner) return { category: canonicalCategory(owner.category), via: `Your rule "${owner.contains}"` };

  const seen = (Array.isArray(costs) ? costs : [])
    .filter((c) => c?.name && canonicalCategory(c.category) && payeesMatch(c.name, p.name))
    .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')))[0];
  if (seen) return { category: canonicalCategory(seen.category), via: `Same supplier as "${seen.name}"` };

  return null;
}

/* ── match ───────────────────────────────────────────────────────────────── */

/** Channel a cost row came from: 'wallet', 'whatsapp', …, or 'manual'. */
const channelOf = (cost) => {
  const s = String(cost?.source || '');
  return s.startsWith('autopilot-') ? s.slice('autopilot-'.length) : 'manual';
};

/**
 * Find what this item refers to among existing costs.
 *
 * One real-world cost can reach Omni four ways (myDATA invoice, emailed PDF,
 * receipt photo, bank debit). Matching is what keeps that ONE cost instead of
 * four, and what lets a bank debit tick an existing bill as Paid rather than
 * adding a second row.
 *
 * @returns {null|{type:'duplicate'|'commitment'|'invoice_payment'|'possible_duplicate',
 *                 targetId, score, why, period?}}
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

  // Only a bank debit is a PAYMENT. An invoice, receipt photo or email is a
  // document: receiving the bill must never tick it paid.
  const isPayment = PAYMENT_SOURCES.has(item.source);

  // 3. A recurring commitment this debit pays (→ tick that occurrence Paid, don't add).
  const commitment = list.find(
    (c) => isCommitment(c, { now })
      && payeesMatch(c.name, payload.name)
      && (isPayment ? amountsMatch(c.amount, payload.amount) : true),
  );
  if (commitment && !isPayment) {
    // The bill for something already budgeted as a standing commitment. Adding
    // it as a new cost would count it twice — the owner decides.
    return {
      type: 'possible_duplicate', targetId: commitment.id, score: 0.6,
      why: `Looks like the bill for your recurring "${commitment.name}" — it may already be counted`,
    };
  }
  if (commitment) {
    const period = settlementPeriodFor(commitment, payload.date);
    if (period) {
      return {
        type: 'commitment', targetId: commitment.id, period, score: 0.9,
        why: `Pays the recurring bill "${commitment.name}" (${period})`,
      };
    }
    // Every occurrence around this date is already ticked: the owner recorded
    // this payment by hand. Adding it again would count it twice.
    return {
      type: 'duplicate', targetId: commitment.id, score: 0.9,
      why: `"${commitment.name}" is already ticked paid for this period`,
    };
  }

  // 4. A one-time cost (e.g. a myDATA invoice) this debit settles later.
  const invoice = isPayment && list.find((c) => {
    if (c.frequency && c.frequency !== 'one-time') return false;
    if (!payeesMatch(c.name, payload.name)) return false;
    if (!amountsMatch(c.amount, payload.amount)) return false;
    const gap = daysBetween(c.startDate, payload.date);
    return gap >= 0 && gap <= paymentWindowDays;
  });
  if (invoice) {
    const period = settlementPeriodFor(invoice, payload.date);
    return period
      ? { type: 'invoice_payment', targetId: invoice.id, period, score: 0.85, why: `Pays "${invoice.name}"` }
      : { type: 'duplicate', targetId: invoice.id, score: 0.85, why: `"${invoice.name}" is already marked paid` };
  }

  // 5. Same money through a DIFFERENT channel under a different name — a receipt
  //    photo "Fuel €18" and the card debit "BP ΚΟΡΙΝΘ €18". Never merged on
  //    amount alone (spec §3.4): held with the suggestion, the owner decides.
  const maybe = list.find((c) => {
    if (c.frequency && c.frequency !== 'one-time') return false;
    if (channelOf(c) === item.source) return false; // same channel = distinct records
    if (Math.abs(toNumber(c.amount) - payload.amount) > 0.01) return false;
    const gap = daysBetween(c.startDate, payload.date);
    const isInvoice = ['mydata', 'gmail'].includes(channelOf(c));
    return Math.abs(gap) <= 3 || (isInvoice && gap >= 0 && gap <= paymentWindowDays);
  });
  if (maybe) {
    return {
      type: 'possible_duplicate', targetId: maybe.id, score: 0.6,
      why: `Same amount as "${maybe.name}" (${maybe.startDate}) — same payment?`,
    };
  }

  return null;
}

/* ── classify ────────────────────────────────────────────────────────────── */

/**
 * Decide: commit automatically, or hold for the owner?
 *
 * @param {object} item     normalized intake item (optionally with .match / .rule set)
 * @param {object} ctx
 * @param {boolean} [ctx.trustWalletCategories=true]  owner switch
 * @param {Set<string>|string[]} [ctx.knownSuppliers]  payee keys with a saved rule
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
      reasons: [item.kind === 'recurring'
        ? 'A new standing commitment is always confirmed by you'
        : 'Money between the owners, the company and its lenders is always reviewed'],
    };
  }
  if (item.noAuto) {
    return {
      decision: 'hold',
      confidence: 0.5,
      reasons: [item.holdReason || 'You undid the automatic entry — waiting for your call'],
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

  // Maybe the same money seen twice — only the owner can say.
  if (match?.type === 'possible_duplicate') {
    return { decision: 'hold', confidence: 0.4, reasons: [match.why] };
  }

  // Nothing below may commit money without a real category.
  if (!payload.category) {
    reasons.push(item.source === 'wallet' ? 'Wallet left this uncategorized' : 'No category yet');
    return { decision: 'hold', confidence: 0.35, reasons };
  }

  // Wallet items the owner already categorized in Wallet — that WAS the review.
  if (item.source === 'wallet') {
    if (trustWalletCategories) {
      reasons.push(`Categorized in Wallet as "${payload.category}"`);
      return { decision: 'auto', confidence: 0.9, reasons };
    }
    reasons.push('Wallet categories are set to be double-checked');
    return { decision: 'hold', confidence: 0.4, reasons };
  }

  // A supplier an earlier decision taught us (rule or history).
  if (item.rule?.category || knownSuppliers.has(payeeKey(payload.name))) {
    reasons.push(item.rule?.via || 'Known supplier with a saved rule');
    return { decision: 'auto', confidence: 0.85, reasons };
  }

  reasons.push(item.source === 'mydata' ? 'New supplier invoice' : 'New payee — first time seen');
  return { decision: 'hold', confidence: 0.35, reasons };
}

/**
 * What the owner still has to supply before a held item can be approved.
 * Shared by the Review page (to enable the button), IntakeContext and the
 * WhatsApp approval path (to refuse an incomplete approval), so they can never
 * disagree.
 *
 * @returns {string|null} the missing field's human label, or null when ready
 */
export function missingForApproval(item, overrides = {}) {
  const p = { ...(item?.payload || {}), ...overrides };
  switch (item?.kind) {
    case 'cost':
      if (!(Number(p.amount) > 0)) return 'Amount';
      if (!canonicalCategory(p.category)) return 'Category';
      return null;
    case 'ledger':
      if (!(Number(p.amount) > 0)) return 'Amount';
      if (!p.ownerUid) return 'Who paid';
      // "I paid a company cost personally" also books the cost → needs a category.
      // A salary accrual is not a cost (the wage cost is booked separately).
      if ((p.ledgerType || 'expense_reimbursable') === 'expense_reimbursable' && !canonicalCategory(p.category)) {
        return 'Category';
      }
      return null;
    case 'loan_payment':
      if (!p.loanId) return 'Loan';
      if (!(Number(p.amount) > 0)) return 'Amount';
      if (Math.abs((Number(p.interest) || 0) + (Number(p.principal) || 0) - Number(p.amount)) > 0.02) {
        return 'Interest / principal split';
      }
      return null;
    case 'recurring':
      if (!(Number(p.amount) > 0)) return 'Amount';
      if (!canonicalCategory(p.category)) return 'Category';
      return null;
    case 'parts_receipt':
      if (!Array.isArray(p.parts) || !p.parts.some((x) => x?.partId && Number(x.qty) > 0)) return 'Parts';
      return null;
    case 'ticket':
      if (!String(p.scooterId || '').trim()) return 'Scooter ID';
      return null;
    case 'issue':
    case 'task':
      if (!String(p.name || '').trim()) return 'Title';
      return null;
    default:
      return 'Unsupported item type';
  }
}

/**
 * Run the whole pipeline for one raw record.
 * Returns the item ready to store, with rules, match + gate applied.
 *
 * @param {object} ctx  { now, rules, knownSuppliers, trustWalletCategories, noAuto }
 */
export function prepareIntakeItem(raw, costs = [], ctx = {}) {
  const item = normalizeIntakeItem(raw, ctx);
  if (ctx.noAuto) item.noAuto = true;

  const rule = applyLearnedRules(item, { rules: ctx.rules, costs });
  if (rule?.category) {
    item.rule = rule;
    if (!item.payload.category) item.payload.category = rule.category;
    if (rule.name && /^ΑΦΜ\s/.test(item.payload.name)) item.payload.name = rule.name;
  }

  item.match = matchIntakeItem(item, costs, ctx);
  const { decision, confidence, reasons } = classifyIntake(item, ctx);
  item.confidence = confidence;
  item.reasons = reasons;
  item.status = decision === 'auto' ? 'auto_committed' : 'pending';
  return item;
}
