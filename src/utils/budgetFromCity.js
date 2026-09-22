/**
 * Derives budget actuals for a project from the existing Cost + Revenue contexts.
 *
 * Revenue rows (RevenueContext) shape:
 *   { date, location, totalPaidRevenue, totalTrips, ... }
 *
 * Cost rows (CostContext) shape:
 *   { name, category, amount, frequency, startDate, notes, ... }
 *   NOTE: costs have NO city/location field — they are fleet-wide.
 *         We return all costs so the Budget Tracker can display them with
 *         a clear "fleet-wide" note rather than silently showing €0.
 *
 * Unit consistency (Bug #509):
 *   expenses is already a MONTHLY figure (costs normalized by frequency).
 *   revenue is normalized to the same monthly basis by dividing the all-time
 *   cumulative sum by the number of calendar months spanned in the dataset.
 *   net = monthlyRevenue - monthlyExpenses (both on a monthly footing).
 */

import { CATEGORIES } from './constants.js';

const FREQ_LABELS = {
  monthly:   'Monthly',
  'one-time': 'One-time',
  quarterly: 'Quarterly',
  annual:    'Annual',
};

/**
 * Given an array of revenue rows (each with a `date` field in YYYY-MM-DD or
 * YYYY-MM format), returns the number of distinct calendar months spanned,
 * minimum 1 so we never divide by zero.
 */
function spanMonths(rows) {
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  if (dates.length === 0) return 1;
  const earliest = new Date(dates[0].slice(0, 7) + '-01T12:00:00Z');
  const latest   = new Date(dates[dates.length - 1].slice(0, 7) + '-01T12:00:00Z');
  const months =
    (latest.getUTCFullYear() - earliest.getUTCFullYear()) * 12 +
    (latest.getUTCMonth() - earliest.getUTCMonth()) + 1;
  return Math.max(1, months);
}

/**
 * Real spend for ONE project: the costs explicitly tagged to it (Autopilot
 * Phase 4 — the cost form's "Project" field). A project budget is a total
 * envelope, so this is money spent to date, not a monthly rate:
 *   - one-time costs count their full amount
 *   - recurring costs count every occurrence from their start until today
 *     (or their end date, whichever is first)
 * Future-dated costs are not spent yet and count 0.
 *
 * @returns {{ spent:number, count:number, transactions:object[] }}
 */
export function projectSpend(costs = [], projectId, now = new Date()) {
  if (!projectId) return { spent: 0, count: 0, transactions: [] };
  const tagged = costs.filter((c) => c && c.projectId === projectId);
  const today = now.toISOString().slice(0, 10);
  const STEP_MONTHS = { monthly: 1, quarterly: 3, yearly: 12, annual: 12 };

  const spentFor = (c) => {
    const amt = Number(c.amount) || 0;
    const start = String(c.startDate || '').slice(0, 10);
    if (!start || start > today) return 0;
    if (!c.frequency || c.frequency === 'one-time') return amt;
    const end = c.endDate && c.endDate < today ? c.endDate : today;
    const [sy, sm] = start.split('-').map(Number);
    const [ey, em] = end.split('-').map(Number);
    const months = (ey - sy) * 12 + (em - sm);
    if (STEP_MONTHS[c.frequency]) return amt * (Math.floor(months / STEP_MONTHS[c.frequency]) + 1);
    const days = Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
    if (c.frequency === 'weekly') return amt * (Math.floor(days / 7) + 1);
    if (c.frequency === 'daily') return amt * (days + 1);
    return amt;
  };

  const transactions = tagged.map((c) => ({
    date: c.startDate || '',
    label: c.name || 'Cost',
    amount: spentFor(c),
    type: 'Cost',
    category: c.category || '',
    frequency: c.frequency || '',
  })).sort((a, b) => (a.date < b.date ? 1 : -1));

  return {
    spent: Math.round(transactions.reduce((s, t) => s + t.amount, 0) * 100) / 100,
    count: tagged.length,
    transactions,
  };
}

/**
 * @param {object[]} costs       - array from CostContext
 * @param {object[]} revenueData - array from RevenueContext
 * @param {string|null} linkedCity
 * @returns {{ revenue, expenses, net, revTransactions, costTransactions }}
 *   revenue  — monthly-equivalent revenue for the linked city
 *   expenses — monthly-equivalent costs (fleet-wide, frequency-normalized)
 *   net      — revenue - expenses (both monthly; comparable units)
 */
export function budgetFromCity(costs, revenueData, linkedCity) {
  // ── Revenue: filter by city (location field), sum totalPaidRevenue ──
  const revRows = linkedCity
    ? revenueData.filter(
        (r) => (r.location || '').toLowerCase() === linkedCity.toLowerCase(),
      )
    : [];

  // Bug #509 fix: normalize cumulative revenue to a monthly average so it is
  // on the same basis as expenses (which are already frequency-normalized to
  // monthly). Without this, revenue grows with history while expenses stay
  // constant, making net meaningless.
  const cumulativeRevenue = revRows.reduce((sum, r) => sum + (r.totalPaidRevenue || 0), 0);
  const revenue = revRows.length > 0 ? cumulativeRevenue / spanMonths(revRows) : 0;

  const revTransactions = revRows.map((r) => ({
    date:      r.date || '',
    label:     r.location ? `Revenue — ${r.location}` : 'Revenue',
    amount:    r.totalPaidRevenue || 0,
    type:      'Revenue',
    category:  '',
    frequency: '',
    trips:     r.totalTrips || 0,
  })).sort((a, b) => (a.date < b.date ? 1 : -1));

  // ── Costs: fleet-wide (no city field exists) ──
  // #123 — normalize by frequency so monthly/yearly/quarterly costs are comparable
  const monthlyAmount = (c) => {
    const amt = Number(c.amount) || 0;
    if (c.frequency === 'monthly') return amt;
    if (c.frequency === 'yearly' || c.frequency === 'annual') return amt / 12;
    if (c.frequency === 'quarterly') return amt / 3;
    if (c.frequency === 'weekly')    return amt * (52 / 12);
    if (c.frequency === 'daily')     return amt * (365 / 12);
    // one-time costs are not recurring; exclude from monthly sum
    // (they still appear in costTransactions for display)
    return 0;
  };
  const expenses = costs.reduce((sum, c) => sum + monthlyAmount(c), 0);

  const costTransactions = costs.map((c) => ({
    date:      c.startDate || c.date || '',
    label:     c.name || '—',
    amount:    Number(c.amount) || 0,
    type:      'Expense',
    category:  CATEGORIES[c.category]?.label || c.category || '—',
    frequency: FREQ_LABELS[c.frequency] || c.frequency || '—',
  })).sort((a, b) => (a.date < b.date ? 1 : -1));

  return {
    revenue,
    expenses,
    net: revenue - expenses,
    revTransactions,
    costTransactions,
  };
}
