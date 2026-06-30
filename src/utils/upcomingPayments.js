/**
 * upcomingPayments — derive a forward-looking payment calendar from the costs you
 * already store. No new schema: "what's coming" is computed from `frequency` +
 * `startDate` (+ optional `endDate`), exactly the data the cost form captures today.
 *
 * Companion to calculations.js (`normalizeToMonthly` answers "how much per month";
 * this module answers "WHEN is the next payment and how much lands in the window").
 * Pure + side-effect-free; pass `now` to make it testable.
 *
 * Mental model (Money overview / Expenses redesign — ADR-0025):
 *   - recurring cost  → a COMMITMENT ("what we have"); its next dated charge is "coming".
 *   - one-time cost   → an ACTUAL record ("what we paid"); a future-dated one is "coming".
 * "coming" is always PROJECTED and kept separate from actuals (never summed together).
 */
import { FREQUENCIES, MONTHS } from './constants.js';

/** 'YYYY-MM' → short month label, e.g. 'Jul' (for the handled-ledger rows). */
function monthShort(periodKey) {
  const m = Number(periodKey.split('-')[1]);
  return MONTHS[m - 1] ?? periodKey;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Months to advance per occurrence for month-anchored frequencies. */
const STEP_MONTHS = { monthly: 1, quarterly: 3, annual: 12, yearly: 12 };
/** Days to advance per occurrence for day-anchored frequencies. */
const STEP_DAYS = { weekly: 7, daily: 1 };

/** Parse a 'YYYY-MM-DD' string to a local-midnight Date, or null if invalid. */
function parseISODate(str) {
  if (!str) return null;
  const [y, m, d] = String(str).split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return isNaN(date.getTime()) ? null : date;
}

/** Strip time → local midnight. */
function atMidnight(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Build a date from a (possibly overflowing) month index, clamping the day to month length. */
function monthAnchoredDate(year, monthIndex, day) {
  const total = year * 12 + monthIndex;
  const ty = Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const daysInMonth = new Date(ty, tm + 1, 0).getDate();
  return new Date(ty, tm, Math.min(day, daysInMonth));
}

/** True for any non one-time frequency (a standing commitment). */
export function isRecurring(cost) {
  return Boolean(cost?.frequency) && cost.frequency !== 'one-time';
}

/**
 * An "actual" is a discrete transaction record (one-time cost or a bank-imported row).
 * These populate the "what we paid" activity ledger; recurring costs are commitments.
 */
export function isActualCost(cost) {
  return !isRecurring(cost);
}

/**
 * A commitment is a recurring cost that hasn't ended yet (future-starting included).
 * Powers the "what we have" section.
 */
export function isCommitment(cost, { now = new Date() } = {}) {
  if (!isRecurring(cost)) return false;
  const end = parseISODate(cost.endDate);
  return !(end && end < atMidnight(now));
}

/**
 * The next payment date ≥ today for a cost, or null if none (ended / past one-time).
 * Recurring occurrences are anchored on the startDate's day-of-month (month-end clamped).
 */
export function nextOccurrence(cost, { now = new Date() } = {}) {
  const start = parseISODate(cost?.startDate);
  if (!start) return null;
  const today = atMidnight(now);
  const end = parseISODate(cost.endDate);
  if (end && end < today) return null;

  // One-time: it's only "next" if it hasn't happened yet.
  if (!isRecurring(cost)) {
    return start >= today ? start : null;
  }

  // Future-starting recurring: first charge is the start date itself.
  if (start >= today) {
    if (end && start > end) return null;
    return start;
  }

  const stepMonths = STEP_MONTHS[cost.frequency];
  const stepDays = STEP_DAYS[cost.frequency];
  let occ = null;

  if (stepMonths) {
    const startDay = start.getDate();
    const monthsDiff =
      (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth());
    // Start one step below the estimate, then walk forward to the first occurrence ≥ today.
    let k = Math.max(0, Math.floor(monthsDiff / stepMonths) - 1);
    for (let guard = 0; guard < 64; guard++) {
      occ = monthAnchoredDate(start.getFullYear(), start.getMonth() + k * stepMonths, startDay);
      if (occ >= today) break;
      k++;
    }
  } else if (stepDays) {
    const daysDiff = Math.floor((today - start) / MS_PER_DAY);
    const n = Math.max(0, Math.ceil(daysDiff / stepDays));
    // Advance by CALENDAR days via the Date constructor (DST-safe). Fixed-ms stepping
    // drifts an hour across a DST boundary and can land on the wrong calendar day.
    occ = new Date(start.getFullYear(), start.getMonth(), start.getDate() + n * stepDays);
    if (occ < today) occ = new Date(start.getFullYear(), start.getMonth(), start.getDate() + (n + 1) * stepDays);
  } else {
    return null; // unknown frequency
  }

  if (end && occ > end) return null;
  return occ;
}

/** The next occurrence date strictly after `occ` (one step), or null for unknown freq. */
function stepOccurrence(cost, occ) {
  const stepMonths = STEP_MONTHS[cost.frequency];
  const stepDays = STEP_DAYS[cost.frequency];
  if (stepMonths) {
    const startDay = parseISODate(cost.startDate).getDate();
    return monthAnchoredDate(occ.getFullYear(), occ.getMonth() + stepMonths, startDay);
  }
  if (stepDays) {
    return new Date(occ.getFullYear(), occ.getMonth(), occ.getDate() + stepDays); // calendar-day step (DST-safe)
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Settlement ledger (ADR-0027) — let the owner tick an upcoming payment as
 * "committed" (earmarked, will leave the account) or "paid" (already debited this
 * month), per-occurrence. Stored on the cost as `settlements: { 'YYYY-MM': { status, at } }`
 * keyed by the occurrence's calendar month. Settled occurrences drop out of "what's
 * coming" (and the recurring forecast advances to the next un-settled month).
 * ─────────────────────────────────────────────────────────────────────────────*/

/** 'YYYY-MM' month key for a Date — the per-occurrence settlement key. */
export function periodKeyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Settlement status ('committed' | 'paid') for the occurrence in `date`'s month, or null. */
export function settlementStatusFor(cost, date) {
  const s = cost?.settlements?.[periodKeyOf(date)];
  if (!s) return null;
  return typeof s === 'string' ? s : (s.status ?? null);
}

/**
 * Like nextOccurrence, but skips occurrences the owner has already settled
 * (committed/paid) — so the forecast shows the next month you still owe.
 */
export function nextUnsettledOccurrence(cost, { now = new Date() } = {}) {
  const end = parseISODate(cost?.endDate);
  let occ = nextOccurrence(cost, { now });
  for (let guard = 0; occ && settlementStatusFor(cost, occ) && guard < 400; guard++) {
    if (!isRecurring(cost)) return null;        // settled one-time → nothing upcoming
    occ = stepOccurrence(cost, occ);
    if (occ && end && occ > end) return null;
  }
  return occ;
}

/** Count + sum the UN-settled occurrences of a recurring cost within [from, to]. */
function occurrencesInWindow(cost, from, to) {
  const amount = Number(cost.amount) || 0;
  const end = parseISODate(cost.endDate);
  const hardEnd = end && end < to ? end : to;

  let count = 0;
  let cursor = nextOccurrence(cost, { now: from });
  for (let guard = 0; cursor && cursor <= hardEnd && guard < 400; guard++) {
    if (!settlementStatusFor(cost, cursor)) count++; // settled occurrences don't count toward "due"
    const nextCursor = stepOccurrence(cost, cursor);
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return { count, total: count * amount };
}

/**
 * Build the upcoming-payments view over a set of costs.
 *
 * @param {Array}  costs
 * @param {Object} opts  - { horizonDays=30, now=new Date() }
 * @returns {{ items, total, byCategory, horizonDays }}
 *   items: [{ id, name, category, frequency, nextDue, amountNext, horizonTotal, isEstimate, occurrenceCount }]
 *   sorted by nextDue ascending. `isEstimate` = true for high-frequency (daily/weekly)
 *   rows whose horizonTotal is an aggregate over many occurrences.
 */
export function upcomingForCosts(costs, { horizonDays = 30, now = new Date() } = {}) {
  const safeCosts = Array.isArray(costs) ? costs : [];
  const today = atMidnight(now);
  const horizonEnd = new Date(today.getTime() + horizonDays * MS_PER_DAY);

  const items = [];
  for (const cost of safeCosts) {
    const amount = Number(cost.amount) || 0;
    if (amount <= 0) continue;
    const next = nextUnsettledOccurrence(cost, { now });
    if (!next || next > horizonEnd) continue;

    let horizonTotal = amount;
    let occurrenceCount = 1;
    let isEstimate = false;

    if (isRecurring(cost)) {
      const win = occurrencesInWindow(cost, today, horizonEnd);
      occurrenceCount = win.count;
      horizonTotal = win.total;
      isEstimate = STEP_DAYS[cost.frequency] != null; // daily/weekly aggregate
    }

    items.push({
      id: cost.id,
      name: cost.name,
      category: cost.category,
      frequency: cost.frequency,
      nextDue: next,
      period: periodKeyOf(next),   // settlement key for the tick action
      amountNext: amount,
      horizonTotal,
      isEstimate,
      occurrenceCount,
    });
  }

  items.sort((a, b) => a.nextDue - b.nextDue);

  const total = items.reduce((s, it) => s + it.horizonTotal, 0);
  const byCategory = items.reduce((acc, it) => {
    acc[it.category] = (acc[it.category] || 0) + it.horizonTotal;
    return acc;
  }, {});

  return { items, total, byCategory, horizonDays };
}

/** Label for the configured frequency (e.g. 'Monthly'), falling back to the raw key. */
export function frequencyLabel(frequency) {
  return FREQUENCIES[frequency]?.label ?? frequency ?? '';
}

/**
 * The owner's settlement ledger over the forecast window (ADR-0027): every cost
 * occurrence ticked 'committed'/'paid' whose month is between the current month and
 * the horizon end, grouped + totalled. Window-scoped (not strictly the calendar
 * month) so an item ticked near month-end — whose next charge is early next month —
 * still appears under "Handled" with its month label, instead of vanishing. Pure.
 */
export function settledThisMonth(costs, { now = new Date(), horizonDays = 30 } = {}) {
  const today = atMidnight(now);
  const period = periodKeyOf(today);
  const endPeriod = periodKeyOf(new Date(today.getTime() + horizonDays * MS_PER_DAY));
  const committed = [];
  const paid = [];
  for (const cost of (Array.isArray(costs) ? costs : [])) {
    const map = cost?.settlements;
    if (!map || typeof map !== 'object') continue;
    for (const [p, s] of Object.entries(map)) {
      if (p < period || p > endPeriod) continue; // current month → horizon only ('YYYY-MM' sorts lexically)
      const status = typeof s === 'string' ? s : s?.status;
      if (status !== 'committed' && status !== 'paid') continue;
      const entry = {
        id: cost.id,
        name: cost.name,
        category: cost.category,
        amount: Number(cost.amount) || 0,
        period: p,
        monthLabel: monthShort(p),
        status,
        at: (s && typeof s === 'object') ? (s.at ?? null) : null,
      };
      (status === 'committed' ? committed : paid).push(entry);
    }
  }
  const committedTotal = committed.reduce((sum, e) => sum + e.amount, 0);
  const paidTotal = paid.reduce((sum, e) => sum + e.amount, 0);
  return { period, committed, paid, committedTotal, paidTotal };
}
