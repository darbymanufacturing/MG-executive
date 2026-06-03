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
    return amt; // one-time / weekly / daily: count as full for budget display
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
