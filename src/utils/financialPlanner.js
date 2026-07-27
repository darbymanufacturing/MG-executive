/**
 * financialPlanner.js
 *
 * Pure calculation engine for the Excel-replica "Financial Planner" dashboard,
 * ported cell-by-cell from "Financial Planner 2022 Recoin Digital.xlsx".
 *
 * MODEL (per the original spreadsheet, per month):
 *   revenue      = sum of that month's revenue
 *   expenses     = software + staff + others category-bucket totals
 *   netCashFlow  = revenue − expenses
 *   dividends    = sum of owner-draw ("CEO" category) items that month
 *   retained     = netCashFlow − dividends
 *   opening      = January → the year's opening-balance input;
 *                  other months → previous month's closing
 *   closing      = opening + retained
 *
 * YEARLY PANEL: revenue/expenses/dividends = sums of the 12 months;
 * netCashFlow = revenue − expenses; retained = netCashFlow − dividends;
 * opening = the year's opening input; closing = opening + retained.
 *
 * KNOWN TEMPLATE BUG (deliberately NOT reproduced): the original Excel
 * yearly "closing balance" cell is wired to `=SUM(Jan_closing:Dec_closing)`
 * — it literally adds up all 12 months' closing balances instead of just
 * carrying December's closing balance forward. That is a copy-paste formula
 * bug in the source spreadsheet, not intended accounting behaviour — this
 * port always computes yearly closing as `opening + retained`, matching the
 * monthly model and standard cash-flow-statement semantics.
 *
 * TREND INDICATORS (exact Excel semantics — see trendValue() below), computed
 * per metric comparing month m to m−1 for m ≥ February; January is always null.
 *
 * DATA MAPPING NOTES:
 *   - Cost rows: { amount, category, frequency, startDate, endDate? }. Rows
 *     with a missing/invalid startDate are skipped entirely.
 *   - Revenue rows: { date, totalPaidRevenue, location, ... }. The Excel spec
 *     for this project calls the grouping field "city", but the live schema
 *     (confirmed by reading src/utils/revenueCalculations.js — see
 *     `revenuePerCityBreakdown` / `filterRevenueByLocation`, both of which key
 *     off `row.location`) stores it as `location`, not `city`. revenueItems
 *     are grouped by `row.location`, falling back to `row.city` for
 *     forward/back-compat, then "Unknown" if neither is present. Rows with a
 *     missing/invalid date are skipped.
 *   - Category buckets (exact category strings from CATEGORIES in
 *     constants.js):
 *       SOFTWARE:  ['SW subscriptions, Telco charges', 'Operations & computing services', 'App Development Fee']
 *       STAFF:     ['Employees', 'Contractors', 'Payroll Fees']
 *       DIVIDENDS: ['CEO']                     (owner draw — NOT an expense)
 *       EXCLUDED:  ['Transfer, withdraw']       (internal money movement — not expense/revenue)
 *       OTHERS:    every other category
 *   - Monthly expansion of a cost into month 'YYYY-MM':
 *       one-time            → counts in its startDate month only, once.
 *       monthly/quarterly/   → step 1/3/12 months; occurs in month M iff
 *       annual/yearly          monthsDiff(startMonth → M) >= 0 AND
 *                              monthsDiff % step === 0 AND (no endDate or
 *                              M <= endDate month). Amount = cost.amount.
 *       weekly               → amount × 52/12 per active month (estimate).
 *       daily                → amount × daysInMonth(M) per active month
 *                              (estimate). "Active" = M between startMonth
 *                              and endDate month (inclusive), no endDate = open-ended.
 *     weekly/daily items are flagged `isEstimate: true`.
 */

const MONTH_NAMES = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

const SOFTWARE_CATEGORIES = ['SW subscriptions, Telco charges', 'Operations & computing services', 'App Development Fee'];
const STAFF_CATEGORIES = ['Employees', 'Contractors', 'Payroll Fees'];
const DIVIDEND_CATEGORIES = ['CEO'];
const EXCLUDED_CATEGORIES = ['Transfer, withdraw'];

export const PLANNER_METRICS = ['revenue', 'expenses', 'netCashFlow', 'dividends', 'retained', 'opening', 'closing'];

export const PLANNER_METRIC_LABELS = {
  revenue: 'REVENUE',
  expenses: 'EXPENSES',
  netCashFlow: 'NET CASH FLOW',
  dividends: 'DIVIDENDS RELEASED',
  retained: 'RETAINED EARNINGS',
  opening: 'OPENING BALANCE',
  closing: 'CLOSING BALANCE',
};

/** Round to 2 decimals via integer cents, guarding float drift. */
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function sumAmounts(items) {
  return items.reduce((s, item) => s + (item.amount || 0), 0);
}

/** 'YYYY-MM-DD...' → true iff it parses to a real calendar date. */
function isValidDateStr(s) {
  if (!s || typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(s)) return false;
  const d = new Date(s);
  return !isNaN(d.getTime());
}

function daysInMonth(year, monthIdx) {
  return new Date(year, monthIdx + 1, 0).getDate();
}

/** 'YYYY-MM' (or a longer ISO string sliced to it) → absolute month index (year*12 + month). */
function absMonth(yyyyMm) {
  const [y, m] = yyyyMm.slice(0, 7).split('-').map(Number);
  return y * 12 + (m - 1);
}

function bucketForCategory(category) {
  if (EXCLUDED_CATEGORIES.includes(category)) return 'excluded';
  if (DIVIDEND_CATEGORIES.includes(category)) return 'dividend';
  if (SOFTWARE_CATEGORIES.includes(category)) return 'software';
  if (STAFF_CATEGORIES.includes(category)) return 'staff';
  return 'others';
}

/**
 * Determine whether `cost` has an occurrence in year/monthIdx (0-indexed month),
 * and if so, its EUR amount for that occurrence.
 * Returns null when the cost does not occur in that month.
 */
function expandCostForMonth(cost, year, monthIdx) {
  if (!cost || !isValidDateStr(cost.startDate)) return null;

  const startKey = absMonth(cost.startDate);
  const targetKey = year * 12 + monthIdx;
  const diff = targetKey - startKey;
  if (diff < 0) return null;

  if (cost.endDate && isValidDateStr(cost.endDate)) {
    const endKey = absMonth(cost.endDate);
    if (targetKey > endKey) return null;
  }

  const amount = Number(cost.amount) || 0;
  const freq = cost.frequency;

  if (freq === 'one-time') {
    return diff === 0 ? { amount, isEstimate: false } : null;
  }

  if (freq === 'monthly' || freq === 'quarterly' || freq === 'annual' || freq === 'yearly') {
    const step = freq === 'monthly' ? 1 : freq === 'quarterly' ? 3 : 12;
    return diff % step === 0 ? { amount, isEstimate: false } : null;
  }

  if (freq === 'weekly') {
    return { amount: amount * (52 / 12), isEstimate: true };
  }

  if (freq === 'daily') {
    return { amount: amount * daysInMonth(year, monthIdx), isEstimate: true };
  }

  // Unknown frequency — no occurrence.
  return null;
}

/**
 * Excel trend semantics comparing `current` to `previous`:
 *   current === 0            → 0  (render nothing / blank chip)
 *   current > previous       → 1  (▲ increase)
 *   current === previous     → 2  (= stable, non-zero)
 *   otherwise                → -1 (▼ decrease)
 */
function trendValue(current, previous) {
  if (current === 0) return 0;
  if (current > previous) return 1;
  if (current === previous) return 2;
  return -1;
}

/**
 * Distinct years present in either dataset (via cost.startDate / revenue.date),
 * ascending. Falls back to [currentYear] when neither dataset has a valid date.
 */
export function plannerYears(costs, revenue, now = new Date()) {
  const years = new Set();
  (costs || []).forEach((c) => {
    if (c && isValidDateStr(c.startDate)) years.add(Number(c.startDate.slice(0, 4)));
  });
  (revenue || []).forEach((r) => {
    if (r && isValidDateStr(r.date)) years.add(Number(r.date.slice(0, 4)));
  });
  if (years.size === 0) return [now.getFullYear()];
  return Array.from(years).sort((a, b) => a - b);
}

/**
 * Build the full Financial Planner model for one year.
 * See the module JSDoc above for the exact formulas and data mapping.
 */
export function buildPlannerModel({ costs = [], revenue = [], year, openingBalance = 0, now = new Date() }) {
  const targetYear = year || now.getFullYear();

  const months = [];
  let runningOpening = round2(openingBalance);

  for (let monthIdx = 0; monthIdx < 12; monthIdx += 1) {
    const key = `${targetYear}-${String(monthIdx + 1).padStart(2, '0')}`;
    const name = MONTH_NAMES[monthIdx];

    // --- Revenue: group by city (row.location, per the live schema) ---
    const revByCity = {};
    (revenue || []).forEach((r) => {
      if (!r || !isValidDateStr(r.date) || !r.date.startsWith(key)) return;
      const label = r.location || r.city || 'Unknown';
      revByCity[label] = (revByCity[label] || 0) + (Number(r.totalPaidRevenue) || 0);
    });
    const revenueItems = Object.entries(revByCity)
      .map(([label, amount]) => ({ label, amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount);

    // --- Expenses + dividends: individual cost occurrences, bucketed ---
    const expenseGroups = { software: [], staff: [], others: [] };
    const dividendItems = [];

    (costs || []).forEach((cost) => {
      if (!cost) return;
      const bucket = bucketForCategory(cost.category);
      if (bucket === 'excluded') return;

      const occ = expandCostForMonth(cost, targetYear, monthIdx);
      if (!occ) return;

      // Carry the cost's business id so the UI can open the row in the cost editor.
      const item = { id: cost.id ?? null, label: cost.name, amount: round2(occ.amount) };
      if (occ.isEstimate) item.isEstimate = true;

      if (bucket === 'dividend') dividendItems.push(item);
      else expenseGroups[bucket].push(item);
    });

    expenseGroups.software.sort((a, b) => b.amount - a.amount);
    expenseGroups.staff.sort((a, b) => b.amount - a.amount);
    expenseGroups.others.sort((a, b) => b.amount - a.amount);

    const totals = {
      revenue: round2(sumAmounts(revenueItems)),
      software: round2(sumAmounts(expenseGroups.software)),
      staff: round2(sumAmounts(expenseGroups.staff)),
      others: round2(sumAmounts(expenseGroups.others)),
    };
    totals.expenses = round2(totals.software + totals.staff + totals.others);

    const dividends = round2(sumAmounts(dividendItems));
    const netCashFlow = round2(totals.revenue - totals.expenses);
    const retained = round2(netCashFlow - dividends);
    const opening = round2(runningOpening);
    const closing = round2(opening + retained);
    runningOpening = closing;

    const hasData = revenueItems.length > 0
      || expenseGroups.software.length > 0
      || expenseGroups.staff.length > 0
      || expenseGroups.others.length > 0
      || dividendItems.length > 0;

    months.push({
      key,
      name,
      revenueItems,
      expenseGroups,
      dividendItems,
      totals,
      summary: {
        revenue: totals.revenue,
        expenses: totals.expenses,
        netCashFlow,
        dividends,
        retained,
        opening,
        closing,
      },
      hasData,
    });
  }

  // --- Yearly panel (see module JSDoc re: the deliberate template-bug deviation) ---
  const yearly = {
    revenue: round2(months.reduce((s, m) => s + m.summary.revenue, 0)),
    expenses: round2(months.reduce((s, m) => s + m.summary.expenses, 0)),
    dividends: round2(months.reduce((s, m) => s + m.summary.dividends, 0)),
    opening: round2(openingBalance),
  };
  yearly.netCashFlow = round2(yearly.revenue - yearly.expenses);
  yearly.retained = round2(yearly.netCashFlow - yearly.dividends);
  yearly.closing = round2(yearly.opening + yearly.retained);

  // --- Trend indicators, per metric, month m vs m-1 (January = null) ---
  const trends = {};
  PLANNER_METRICS.forEach((metric) => {
    trends[metric] = months.map((m, i) => {
      if (i === 0) return null;
      return trendValue(m.summary[metric], months[i - 1].summary[metric]);
    });
  });

  return { year: targetYear, months, yearly, trends };
}
