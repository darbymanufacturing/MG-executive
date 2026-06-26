/**
 * taxSummary — pure breakdown of the owner's tax & statutory-duty spend, for the
 * dedicated /taxes view. "Tax" categories are the ones flagged `isTax` in
 * CATEGORIES (VAT, ΓΕΜΗ, Company Registration Fees, Customs) — see TAX_CATEGORY_KEYS.
 *
 * Side-effect-free; takes an injectable `now` for tests (mirrors calculations.js).
 * Operates on already-scoped costs (pass useMetrics().scopedCosts) so it inherits
 * fleet scoping — it does NOT re-scope.
 */
import { CATEGORIES, TAX_CATEGORY_KEYS } from './constants.js';

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const TAX_SET = new Set(TAX_CATEGORY_KEYS);

export function isTaxCost(c) {
  return !!c && TAX_SET.has(c.category);
}

/**
 * @param {Array} costs   cost rows ({ category, amount, startDate, ... })
 * @param {{ now?: Date }} opts
 * @returns {{
 *   categories: Array<{key,label,color,total,ytd,count}>,  // sorted desc by total
 *   totalAllTime: number, totalYTD: number, count: number,
 *   monthly: Array<{ month: 'YYYY-MM', total: number }>,    // chronological
 *   year: number,
 * }}
 */
export function taxBreakdown(costs = [], { now } = {}) {
  const today = now instanceof Date ? now : new Date();
  const year = today.getFullYear();

  const taxes = (costs || []).filter(isTaxCost);
  const byCategory = {};
  const monthly = {};
  let totalAllTime = 0;
  let totalYTD = 0;

  for (const c of taxes) {
    const amt = Number(c.amount) || 0;
    const key = c.category;
    if (!byCategory[key]) {
      byCategory[key] = {
        key,
        label: CATEGORIES[key]?.label || key,
        color: CATEGORIES[key]?.color || '#9CA3AF',
        total: 0,
        ytd: 0,
        count: 0,
      };
    }
    byCategory[key].total += amt;
    byCategory[key].count += 1;
    totalAllTime += amt;

    const d = c.startDate ? new Date(c.startDate) : null;
    const valid = d && !Number.isNaN(d.getTime());
    if (valid && d.getFullYear() === year) {
      byCategory[key].ytd += amt;
      totalYTD += amt;
    }
    if (valid) {
      const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthly[m] = (monthly[m] || 0) + amt;
    }
  }

  const categories = Object.values(byCategory)
    .map((e) => ({ ...e, total: round2(e.total), ytd: round2(e.ytd) }))
    .sort((a, b) => b.total - a.total);

  const monthlySeries = Object.entries(monthly)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({ month, total: round2(total) }));

  return {
    categories,
    totalAllTime: round2(totalAllTime),
    totalYTD: round2(totalYTD),
    count: taxes.length,
    monthly: monthlySeries,
    year,
  };
}
