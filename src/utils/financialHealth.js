/**
 * Financial health calculations for the XSlide Fleet Cost Manager dashboard.
 * All functions return null when insufficient data is available.
 */
import { normalizeToAnnual, normalizeToMonthly, totalMonthlyCost, totalAnnualCost } from './calculations.js';
import { monthlyRevenueSummary } from './revenueCalculations.js';

/**
 * Annualized revenue: average of months that have data × 12.
 * Consistent with actualRevenuePerScooterMonthly pattern.
 */
export function annualizedRevenue(revenueData) {
  if (!revenueData.length) return 0;
  const summary = monthlyRevenueSummary(revenueData);
  const active = summary.filter((m) => m.revenue > 0);
  if (!active.length) return 0;
  const avgMonthly = active.reduce((s, m) => s + m.revenue, 0) / active.length;
  return avgMonthly * 12;
}

/** Total annualized cost of investment-category items only */
export function annualInvestmentCost(costs) {
  return costs
    .filter((c) => c.category === 'investment')
    .reduce((s, c) => s + normalizeToAnnual(c), 0);
}

/**
 * EBITDA ≈ Revenue − Operating Costs (all except investment category).
 * Returns { ebitda, ebitdaMargin } or { ebitda: null, ebitdaMargin: null }.
 */
export function calcEBITDA(costs, revenueData) {
  const annualRev = annualizedRevenue(revenueData);
  if (!annualRev) return { ebitda: null, ebitdaMargin: null };

  const annualOpsCost = costs
    .filter((c) => c.category !== 'investment')
    .reduce((s, c) => s + normalizeToAnnual(c), 0);

  const ebitda = annualRev - annualOpsCost;
  const ebitdaMargin = (ebitda / annualRev) * 100;
  return { ebitda, ebitdaMargin };
}

/**
 * ROI = (Annual Net Profit / Total Annual Investment Costs) × 100.
 * Returns null if no investment costs or no revenue.
 */
export function calcROI(costs, revenueData) {
  const investmentCost = annualInvestmentCost(costs);
  if (!investmentCost) return null;
  const annualRev = annualizedRevenue(revenueData);
  if (!annualRev) return null;
  const netProfit = annualRev - totalAnnualCost(costs);
  return (netProfit / investmentCost) * 100;
}

/**
 * DSCR = Annual Operating Cash Flow / Annual Debt Service.
 * Returns null if monthlyDebtService is null/0 or no revenue.
 */
export function calcDSCR(costs, revenueData, config) {
  const debt = config.monthlyDebtService;
  if (!debt) return null;
  const annualRev = annualizedRevenue(revenueData);
  if (!annualRev) return null;

  const annualOpsCost = costs
    .filter((c) => c.category !== 'investment')
    .reduce((s, c) => s + normalizeToAnnual(c), 0);

  const operatingCashFlow = annualRev - annualOpsCost;
  return operatingCashFlow / (debt * 12);
}

/** Break-even monthly revenue = total monthly costs (always available) */
export function calcBreakEvenRevenue(costs) {
  return totalMonthlyCost(costs);
}

/**
 * Payback Period in months: Total Investment Costs / Monthly Net Profit.
 * Returns Infinity if monthly profit ≤ 0, null if no investment costs.
 */
export function calcPaybackPeriod(costs, revenueData) {
  const totalInv = annualInvestmentCost(costs);
  if (!totalInv) return null;
  const annualRev = annualizedRevenue(revenueData);
  if (!annualRev) return null;
  const monthlyRev = annualRev / 12;
  const monthlyNet = monthlyRev - totalMonthlyCost(costs);
  if (monthlyNet <= 0) return Infinity;
  return totalInv / monthlyNet;
}

/**
 * Cost Recovery Rate = Annualized Revenue / Total Annual Costs.
 * 1.0 = breaking even, >1 = profitable.
 */
export function calcCostRecoveryRate(costs, revenueData) {
  const annualRev = annualizedRevenue(revenueData);
  if (!annualRev) return null;
  const annualCost = totalAnnualCost(costs);
  if (!annualCost) return null;
  return annualRev / annualCost;
}

/**
 * Month-over-month revenue growth: (current month − previous month) / previous month × 100.
 * Returns null if no prior month data.
 */
export function calcRevGrowthMoM(revenueData) {
  const now = new Date();
  const year = now.getFullYear();
  const summary = monthlyRevenueSummary(revenueData, year);
  const currentIdx = now.getMonth();
  const curr = summary[currentIdx]?.revenue || 0;
  const prev = currentIdx > 0 ? (summary[currentIdx - 1]?.revenue || 0) : 0;
  if (!prev) return null;
  return ((curr - prev) / prev) * 100;
}

/** Traffic-light thresholds for each metric */
const HEALTH_THRESHOLDS = {
  ebitdaMargin:  { green: 20,   amber: 0,    inverted: false },
  roi:           { green: 15,   amber: 0,    inverted: false },
  dscr:          { green: 1.25, amber: 1.0,  inverted: false },
  paybackMonths: { green: 24,   amber: 48,   inverted: true  },
  costRecovery:  { green: 1.0,  amber: 0.8,  inverted: false },
  revGrowth:     { green: 5,    amber: 0,    inverted: false },
};

/** Returns 'green' | 'amber' | 'red' | 'muted' for a given metric value */
export function getHealthColor(metric, value) {
  if (value === null || value === undefined || !isFinite(value)) return 'muted';
  const t = HEALTH_THRESHOLDS[metric];
  if (!t) return 'muted';
  if (t.inverted) {
    if (value <= t.green) return 'green';
    if (value <= t.amber) return 'amber';
    return 'red';
  }
  if (value >= t.green) return 'green';
  if (value >= t.amber) return 'amber';
  return 'red';
}
