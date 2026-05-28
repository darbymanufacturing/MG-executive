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
 */

import { CATEGORIES } from './constants.js';

const FREQ_LABELS = {
  monthly:   'Monthly',
  'one-time': 'One-time',
  quarterly: 'Quarterly',
  annual:    'Annual',
};

/**
 * @param {object[]} costs       - array from CostContext
 * @param {object[]} revenueData - array from RevenueContext
 * @param {string|null} linkedCity
 * @returns {{ revenue, expenses, net, revTransactions, costTransactions }}
 */
export function budgetFromCity(costs, revenueData, linkedCity) {
  // ── Revenue: filter by city (location field), sum totalPaidRevenue ──
  const revRows = linkedCity
    ? revenueData.filter(
        (r) => (r.location || '').toLowerCase() === linkedCity.toLowerCase(),
      )
    : [];

  const revenue = revRows.reduce((sum, r) => sum + (r.totalPaidRevenue || 0), 0);

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
