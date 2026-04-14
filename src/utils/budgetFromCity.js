/**
 * Derives budget actuals for a project from the existing Cost + Revenue contexts.
 *
 * Each project can be linked to a city (e.g. 'Nafplion', 'Corinth').
 * We filter the live cost/revenue arrays by that city to get actuals.
 *
 * Revenue rows use a `location` field.
 * Cost rows use a `city` or `location` field (depending on import format).
 */

/**
 * @param {object[]} costs     - array from CostContext
 * @param {object[]} revenueData - array from RevenueContext
 * @param {string|null} linkedCity  - e.g. 'Nafplion', 'Corinth', or null
 * @returns {{ revenue: number, expenses: number, net: number, transactions: object[] }}
 */
export function budgetFromCity(costs, revenueData, linkedCity) {
  if (!linkedCity) {
    return { revenue: 0, expenses: 0, net: 0, transactions: [] };
  }

  const cityLower = linkedCity.toLowerCase();

  // Revenue: sum amount for rows matching this city
  const revRows = revenueData.filter(
    (r) => (r.location || r.city || '').toLowerCase() === cityLower,
  );
  const revenue = revRows.reduce((sum, r) => sum + (Number(r.amount) || Number(r.revenue) || 0), 0);

  // Costs: sum amount for rows matching this city
  const costRows = costs.filter(
    (c) =>
      (c.city || c.location || '').toLowerCase() === cityLower ||
      (c.tags || []).some((t) => t.toLowerCase() === cityLower),
  );
  const expenses = costRows.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);

  // Combined transaction list for the linked-transactions section
  const transactions = [
    ...costRows.map((c) => ({
      date: c.date || c.startDate || '',
      label: c.name || c.description || '',
      amount: Number(c.amount) || 0,
      type: 'Expense',
      frequency: c.frequency || 'One-time',
    })),
    ...revRows.map((r) => ({
      date: r.date || '',
      label: r.location || 'Revenue',
      amount: Number(r.amount) || Number(r.revenue) || 0,
      type: 'Revenue',
      frequency: 'One-time',
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  return { revenue, expenses, net: revenue - expenses, transactions };
}
