/**
 * Financial health calculations for the XSlide Fleet Cost Manager dashboard.
 * All functions return null when insufficient data is available.
 *
 * All revenue-consuming functions accept an optional `financial` param (config.financial).
 * When provided, annualizedRevenue applies franchise fee and SIM deductions so that
 * P&L metrics reflect operating revenue, not gross paid revenue.
 */
import { normalizeToAnnual, totalMonthlyCost } from './calculations.js';
import { monthlyRevenueSummary } from './revenueCalculations.js';

/**
 * Annualized revenue based on the actual data span.
 * - If ≥12 months of history exist: sums the last 12 calendar months exactly
 *   (zero months for off-season are included, so seasonal businesses aren't overstated).
 * - If <12 months: scales total by (12 / spanMonths) for a fair extrapolation.
 *
 * When `financial` (config.financial) is provided, applies franchise fee and monthly
 * SIM deductions so downstream health metrics reflect operating revenue, not gross.
 */
export function annualizedRevenue(revenueData, financial, options = {}) {
  if (!revenueData.length) return 0;

  const fin = financial ? {
    applyFranchiseFee: true,
    franchiseRate: 0.19,
    vatRate: 0.24,
    monthlySimCost: 150,
    ...financial,
  } : null;

  const applyFin = (grossAnnual, months) => {
    if (!fin) return grossAnnual;
    const revenueMultiplier = fin.applyFranchiseFee ? (1 - fin.franchiseRate) : 1;
    return grossAnnual * revenueMultiplier - fin.monthlySimCost * months;
  };

  // Determine data span in months
  const dates    = revenueData.map((r) => r.date).filter(Boolean).sort();
  if (!dates.length) return 0;
  const earliest = new Date(dates[0]   + 'T12:00:00Z');
  const latest   = new Date(dates[dates.length - 1] + 'T12:00:00Z');
  const spanMonths = (latest.getUTCFullYear() - earliest.getUTCFullYear()) * 12
    + (latest.getUTCMonth() - earliest.getUTCMonth()) + 1;

  if (spanMonths >= 12) {
    // Sum the last 12 complete calendar months (including off-season zeros)
    const now = options.now ?? new Date();
    let grossTotal = 0;
    for (let i = 0; i < 12; i++) {
      const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      grossTotal += revenueData
        .filter((r) => r.date.startsWith(key))
        .reduce((s, r) => s + (r.totalPaidRevenue || 0), 0);
    }
    return applyFin(grossTotal, 12);
  }

  // Less than 12 months of data: scale by actual span
  const totalRev = revenueData.reduce((s, r) => s + (r.totalPaidRevenue || 0), 0);
  const annualGross = (totalRev / spanMonths) * 12;
  return applyFin(annualGross, 12);
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
export function calcEBITDA(costs, revenueData, financial) {
  const annualRev = annualizedRevenue(revenueData, financial);
  if (!annualRev) return { ebitda: null, ebitdaMargin: null };

  // Use run-rate monthly * 12 so one-time rows (monthlyMultiplier: 0) are excluded,
  // matching the numbers hub's annualTotal = monthlyCostRate * 12 rule (ADR-0024 / #607).
  const annualOpsCost = totalMonthlyCost(
    costs.filter((c) => c.category !== 'investment'),
  ) * 12;

  const ebitda = annualRev - annualOpsCost;
  const ebitdaMargin = (ebitda / annualRev) * 100;
  return { ebitda, ebitdaMargin };
}

/**
 * ROI = (Annual Net Profit / Total Annual Investment Costs) × 100.
 * Returns null if no investment costs or no revenue.
 */
export function calcROI(costs, revenueData, financial) {
  const investmentCost = annualInvestmentCost(costs);
  if (!investmentCost) return null;
  const annualRev = annualizedRevenue(revenueData, financial);
  if (!annualRev) return null;
  // Run-rate annual: monthly * 12 excludes one-time rows (ADR-0024 / #607).
  const netProfit = annualRev - totalMonthlyCost(costs) * 12;
  return (netProfit / investmentCost) * 100;
}

/**
 * DSCR = Annual Operating Cash Flow / Annual Debt Service.
 * Returns null if monthlyDebtService is null/0 or no revenue.
 */
export function calcDSCR(costs, revenueData, config, financial) {
  const debt = config.monthlyDebtService;
  if (!debt) return null;
  const annualRev = annualizedRevenue(revenueData, financial);
  if (!annualRev) return null;

  // Run-rate monthly * 12 excludes one-time rows (ADR-0024 / #607).
  const annualOpsCost = totalMonthlyCost(
    costs.filter((c) => c.category !== 'investment'),
  ) * 12;

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
export function calcPaybackPeriod(costs, revenueData, financial) {
  const totalInv = annualInvestmentCost(costs);
  if (!totalInv) return null;
  const annualRev = annualizedRevenue(revenueData, financial);
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
export function calcCostRecoveryRate(costs, revenueData, financial) {
  const annualRev = annualizedRevenue(revenueData, financial);
  if (!annualRev) return null;
  // Run-rate annual: monthly * 12 excludes one-time rows (ADR-0024 / #607).
  const annualCost = totalMonthlyCost(costs) * 12;
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
  const currentIdx = now.getMonth();
  const curr = monthlyRevenueSummary(revenueData, year)[currentIdx]?.revenue || 0;

  let prev = 0;
  if (currentIdx > 0) {
    prev = monthlyRevenueSummary(revenueData, year)[currentIdx - 1]?.revenue || 0;
  } else {
    // January: look at December of the prior year
    prev = monthlyRevenueSummary(revenueData, year - 1)[11]?.revenue || 0;
  }
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
  if (value === null || value === undefined) return 'muted';
  // Infinity on an inverted metric (e.g. payback period) means never-recovers → danger
  if (!isFinite(value)) {
    const t = HEALTH_THRESHOLDS[metric];
    return (t?.inverted) ? 'red' : 'muted';
  }
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
