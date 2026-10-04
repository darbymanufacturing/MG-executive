/**
 * financialSummary — the single pure selector that owns ALL financial-total math.
 *
 * Why this exists (ADR-0024): before W5, every page (Dashboard/Pulse, PulseStrip,
 * Investment) recomputed period costs, run-rate annualization, per-scooter rates and
 * the revenue breakdown inline. Those copies drifted (#601 inflated /year via
 * totalAnnualCost; #602 per-scooter year; #603 Home-vs-Pulse Costs-MTD mismatch).
 * This module is the one place those rules live. Pages READ a summary; they never
 * recompute. `MetricsProvider` memoizes one instance per (scope, period) and hands it out.
 *
 * Side-effect-free. Reuses primitives from calculations.js + revenueCalculations.js —
 * nothing is reinvented here. The only NEW knowledge it encodes is the period-filter
 * boundaries (ported verbatim from Dashboard.jsx / PulseStrip.jsx) and the
 * "annual = monthly-run-rate × 12" rule (NOT totalAnnualCost — see #601).
 *
 * Three rules about TIME live here too (ADR-0032, #711/#712):
 *   - "now" ('all' mode) is today's run-rate: a recurring cost that has ended is history,
 *     so it is not in monthlyCostRate / annualTotal / per-scooter / costByCategory;
 *   - a recurring cost belongs to a month only if it is still running on its own billing
 *     day in that month (isActiveInMonth) — month mode and costsMTD share that one test;
 *   - "paid" is evidence (a settlement tick or an actual record), never "it was active".
 *
 * @param {Array}  costs    - already fleet-scoped + location-filtered by the caller
 * @param {Array}  revenue  - already fleet-scoped + location-filtered by the caller
 * @param {Array}  scooters - already fleet-scoped (drives the LIVE active/total counts)
 * @param {Object} config   - useCosts().config (fleetSize, financial, locations, …)
 * @param {Object} period   - { mode:'month'|'range'|'all', monthKey?, from?, to?, months? }
 *                            monthKey: 'YYYY-MM' (month mode). from/to: 'YYYY-MM' (range mode).
 * @param {Object} options  - { activeStatus='Active', now=new Date() }  // testable clock
 * @returns {FinancialSummary}
 */
import {
  normalizeToMonthly,
  totalMonthlyCost,
  costPerScooterMonthly,
  costPerScooterDaily,
  breakdownByCategory,
} from './calculations.js';
import { revenueBreakdown } from './revenueCalculations.js';
import { annualizedRevenue as annualizedRevenueFn } from './financialHealth.js';
import { currentCosts, isCommitment, isActiveInMonth, monthPayments } from './upcomingPayments.js';

/**
 * Period-cost filter — recurring costs ACTIVE this period OR one-time costs DATED in period
 * (the #603 structural fix: one predicate for every page). "Active" is isActiveInMonth —
 * end-date aware to the billing day (#712). Only applied for 'month' mode.
 */
function filterPeriodCosts(costs, period) {
  if (period.mode !== 'month' || !period.monthKey) return costs;
  const [y, m] = period.monthKey.split('-').map(Number);
  return costs.filter((c) => isActiveInMonth(c, y, m - 1));
}

/**
 * Σ raw amount of one-time costs dated in the period.
 * Verbatim port of Dashboard.jsx:199-213 (the three-branch month/range/all logic).
 * `periodCosts` is the month-filtered set (used by the 'month' branch).
 */
function sumOneTimeInPeriod(periodCosts, filteredCosts, period) {
  if (period.mode === 'month') {
    return periodCosts
      .filter((c) => c.frequency === 'one-time')
      .reduce((s, c) => s + (c.amount || 0), 0);
  }
  if (period.mode === 'range' && period.from && period.to) {
    const lo = period.from + '-01';
    const hi = period.to + '-99';
    return filteredCosts
      .filter((c) => c.frequency === 'one-time' && c.startDate >= lo && c.startDate <= hi)
      .reduce((s, c) => s + (c.amount || 0), 0);
  }
  return filteredCosts
    .filter((c) => c.frequency === 'one-time')
    .reduce((s, c) => s + (c.amount || 0), 0);
}

/**
 * Period-revenue filter — verbatim port of Dashboard.jsx:145-156.
 * '-01'/'-99' sentinels make the range bounds inclusive of whole months.
 */
function filterPeriodRevenue(revenue, period) {
  if (period.mode === 'month') {
    if (!period.monthKey) return revenue;
    return revenue.filter((r) => r.date?.startsWith(period.monthKey));
  }
  if (period.mode === 'range') {
    return revenue.filter((r) => {
      const d = r.date;
      return (!period.from || d >= period.from + '-01') && (!period.to || d <= period.to + '-99');
    });
  }
  return revenue;
}

const FIN_DEFAULTS = {
  applyFranchiseFee: true,
  franchiseRate: 0.19,
  vatRate: 0.24,
  monthlySimCost: 150,
};

export function financialSummary(costs, revenue, scooters, config, period, options = {}) {
  const safeCosts = Array.isArray(costs) ? costs : [];
  const safeRevenue = Array.isArray(revenue) ? revenue : [];
  const safeScooters = Array.isArray(scooters) ? scooters : [];
  const cfg = config || {};
  const activeStatus = options.activeStatus ?? 'Active';
  const now = options.now ?? new Date();

  // Normalize period; months defaults to 1 (single month), guarded ≥ 0 below for divides.
  const p = {
    mode: period?.mode ?? 'all',
    monthKey: period?.monthKey ?? null,
    from: period?.from ?? null,
    to: period?.to ?? null,
    months: period?.months ?? 1,
  };
  const periodMonths = Number.isFinite(p.months) ? Math.max(0, p.months) : 1;

  // ── Period-scoped cost set ────────────────────────────────────────────────
  const periodCosts = filterPeriodCosts(safeCosts, p);
  // #711 — what counts today: commitments still running + every one-time record.
  const costsNow = currentCosts(safeCosts, { now });
  // month → the month's own set · all → today's run-rate (ended commitments are history) ·
  // range → the full set (legacy classic-dashboard approximation: run-rate × months).
  const costsForRate = p.mode === 'month' ? periodCosts : p.mode === 'all' ? costsNow : safeCosts;
  // The count shown beside the run-rate uses the SAME predicate, so the two cannot disagree.
  const commitmentCount = safeCosts.filter((c) => isCommitment(c, { now })).length;

  // ── Cost totals ────────────────────────────────────────────────────────────
  // one-time EXCLUDED from the monthly rate (FREQUENCIES['one-time'].monthlyMultiplier = 0).
  const monthlyCostRate = totalMonthlyCost(costsForRate);
  const oneTimeInPeriod = sumOneTimeInPeriod(periodCosts, safeCosts, p);
  // displayTotal = run-rate × period span + one-time landed in period (Dashboard.jsx:214).
  const displayTotal = monthlyCostRate * periodMonths + oneTimeInPeriod;
  // #601 — annual = recurring run-rate × 12, the ONLY annual rule. NEVER totalAnnualCost():
  // that sums every one-time row (e.g. ~400 imported credit-card txns) into one "year".
  const annualTotal = monthlyCostRate * 12;
  const costByCategory = breakdownByCategory(costsForRate);

  // ── Live fleet count + per-scooter (LIVE count, config.fleetSize fallback) ──
  // liveFleetSize: the fleet-scoped scooter count, or null when none are loaded.
  const liveFleetSize = safeScooters.length > 0 ? safeScooters.length : null;
  // Dashboard.jsx:112 — effective = live ?? configured scalar.
  const fleetSizeEffective = liveFleetSize ?? cfg.fleetSize;
  // #640 — use costsForRate (period-filtered in month mode, same as monthlyCostRate) so that
  // perScooterMonthly === monthlyCostRate / fleetSize for any selected period.
  const perScooterMonthly = costPerScooterMonthly(costsForRate, fleetSizeEffective);
  const perScooterDaily = costPerScooterDaily(costsForRate, fleetSizeEffective);
  const perScooterAnnual = perScooterMonthly * 12; // #601-consistent run-rate × 12.

  // ── Counts ─────────────────────────────────────────────────────────────────
  const scooterCountTotal = safeScooters.length;
  const scooterCountActive = safeScooters.filter((s) => s.status === activeStatus).length;
  // Distinct locations = configured locations ∪ scooter cities.
  const locSet = new Set();
  (cfg.locations || []).forEach((l) => { if (l) locSet.add(String(l).toLowerCase()); });
  safeScooters.forEach((s) => { if (s.city) locSet.add(String(s.city).toLowerCase()); });
  const locationCount = locSet.size;

  // ── Revenue (period) ────────────────────────────────────────────────────────
  const financial = cfg.financial || FIN_DEFAULTS;
  const periodRevenue = filterPeriodRevenue(safeRevenue, p);
  const rev = revenueBreakdown(periodRevenue, financial, periodMonths);

  // Two DIFFERENT revenue bases, both exposed (never swap silently — see ADR-0024 / §7):
  //  - operatingRevenue (above): the period's net operating revenue (P&L basis).
  //  - annualizedRevenue: trailing-12-month basis from financialHealth (Investment parity).
  const annualizedRevenue = annualizedRevenueFn(safeRevenue, financial, { now });

  // monthlyOpexExInvestment: monthly run-rate of every non-investment cost (FleetRoiTab
  // parity — its baseMonthlyOpex). #278 — skip null/undefined categories to avoid NaN.
  const monthlyOpexExInvestment = totalMonthlyCost(
    costsNow.filter((c) => c.category && c.category !== 'investment'),
  );

  // MTD figures (current calendar month relative to `now`) — PulseStrip parity.
  const mtdY = now.getFullYear();
  const mtdMonthIdx = now.getMonth();
  const mtdKey = `${mtdY}-${String(mtdMonthIdx + 1).padStart(2, '0')}`;
  // revenueMTD: gross current-month revenue (PulseStrip.jsx:96-98 — raw totalPaidRevenue).
  const revenueMTD = safeRevenue
    .filter((r) => r.date?.startsWith(mtdKey))
    .reduce((s, r) => s + (r.totalPaidRevenue || 0), 0);
  // costsMTD: this month's COSTS (accrual) — recurring active this month at the monthly
  // rate + one-time dated this month (the #603 basis). Computed independently of `period`.
  // It is the month's cost, NOT what has been paid — see paidThisMonth below (#712).
  // costsMTDByCategory: the SAME predicate + amounts, grouped by category, so
  // Σ(values) === costsMTD exactly. Unlike costByCategory (a monthly run-rate that excludes
  // one-time rows), this includes one-time costs dated this month.
  const mtdCostOf = (c) => {
    if (!isActiveInMonth(c, mtdY, mtdMonthIdx)) return 0;
    return c.frequency === 'one-time' ? (c.amount || 0) : normalizeToMonthly(c);
  };
  const costsMTD = safeCosts.reduce((s, c) => s + mtdCostOf(c), 0);
  const costsMTDByCategory = safeCosts.reduce((acc, c) => {
    const v = mtdCostOf(c);
    if (v) acc[c.category] = (acc[c.category] || 0) + v;
    return acc;
  }, {});

  // Cash view of the same month (#712): what falls due, and what is actually paid.
  const payments = monthPayments(safeCosts, { now });

  // ── P&L ─────────────────────────────────────────────────────────────────────
  const displayPnL = rev.operatingRevenue - displayTotal;

  return {
    // costs (period)
    monthlyCostRate,
    oneTimeInPeriod,
    displayTotal,
    annualTotal,
    costByCategory,
    commitmentCount,

    // per-scooter (LIVE fleet count)
    fleetSizeEffective,
    liveFleetSize,
    perScooterMonthly,
    perScooterDaily,
    perScooterAnnual,

    // counts
    scooterCountTotal,
    scooterCountActive,
    locationCount,

    // revenue (period)
    revenue: rev,
    annualizedRevenue,
    monthlyOpexExInvestment,
    revenueMTD,
    costsMTD,
    costsMTDByCategory,
    // cash, this month: paid (evidence) of due (charges that fall in the month)
    paidThisMonth: payments.paidTotal,
    paidCountThisMonth: payments.paidCount,
    paidThisMonthByCategory: payments.paidByCategory,
    dueThisMonth: payments.dueTotal,
    dueCountThisMonth: payments.dueCount,

    // P&L
    displayPnL,

    // provenance (powers the Numbers Inspector)
    _inputs: {
      costCount: safeCosts.length,
      periodCostCount: costsForRate.length,
      revenueRowCount: periodRevenue.length,
      scooterCount: safeScooters.length,
      period: p,
      periodMonths,
      financial,
      activeStatus,
      computedAt: now instanceof Date ? now.toISOString() : String(now),
    },
  };
}
