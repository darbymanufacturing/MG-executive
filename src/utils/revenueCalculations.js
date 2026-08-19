import { MONTHS } from './constants.js';
import { totalMonthlyCost, allTimeMonthlyTrendData } from './calculations.js';

const DAY_ABBRS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** Accumulate EUR values in integer cents to avoid float drift. */
function sumCents(items, getValue) {
  return items.reduce((s, item) => s + Math.round((getValue(item) || 0) * 100), 0) / 100;
}

/**
 * Daily revenue breakdown for a selected month (YYYY-MM string).
 * Returns one entry per calendar day with actual revenue, daily cost rate,
 * trips, and profit/loss. Used by the "By Month" daily chart on Dashboard.
 */
export function dailyRevenueTrend(periodRevenue, costs, selectedMonth) {
  if (!selectedMonth) return [];
  const [y, m] = selectedMonth.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();

  // Revenue lookup by exact date string (accumulated in integer cents to avoid float drift)
  const revCentsDate = {};
  const tripsByDate  = {};
  periodRevenue.forEach((r) => {
    revCentsDate[r.date] = (revCentsDate[r.date] || 0) + Math.round((r.totalPaidRevenue || 0) * 100);
    tripsByDate[r.date]  = (tripsByDate[r.date]  || 0) + (r.totalTrips || 0);
  });

  // Spread recurring monthly costs evenly; land one-time costs on their exact startDate
  const monthlyCost      = totalMonthlyCost(costs);
  const recurringDailyRate = monthlyCost / daysInMonth;

  // Build a per-day map for one-time costs that fall in this month
  const oneTimeCostByDate = {};
  costs
    .filter((c) => c.frequency === 'one-time' && c.startDate?.startsWith(selectedMonth))
    .forEach((c) => {
      const d = c.startDate.slice(0, 10); // YYYY-MM-DD
      oneTimeCostByDate[d] = (oneTimeCostByDate[d] || 0) + (c.amount || 0);
    });

  return Array.from({ length: daysInMonth }, (_, i) => {
    const dayNum  = i + 1;
    const dateStr = `${selectedMonth}-${String(dayNum).padStart(2, '0')}`;
    const revenue = (revCentsDate[dateStr] || 0) / 100;
    const trips   = tripsByDate[dateStr] || 0;
    const hasData = !!revCentsDate[dateStr];
    const costRate = parseFloat((recurringDailyRate + (oneTimeCostByDate[dateStr] || 0)).toFixed(2));
    return {
      day:      `${DAY_ABBRS[m - 1]} ${dayNum}`,
      date:     dateStr,
      revenue:  parseFloat(revenue.toFixed(2)),
      costRate,
      profit:   parseFloat((revenue - costRate).toFixed(2)),
      trips,
      hasData,
    };
  });
}

/** Filter revenue rows to a date range (inclusive). Pass null to skip bound. */
export function filterByRange(revenueData, startDate, endDate) {
  return revenueData.filter((r) => {
    if (startDate && r.date < startDate) return false;
    if (endDate   && r.date > endDate)   return false;
    return true;
  });
}

/** Sum of totalPaidRevenue across all rows */
export function totalRevenue(revenueData) {
  return sumCents(revenueData, (r) => r.totalPaidRevenue);
}

/** Total revenue for the current calendar month */
export function currentMonthRevenue(revenueData) {
  const now = new Date();
  const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return totalRevenue(revenueData.filter((r) => r.date.startsWith(prefix)));
}

/** Revenue per scooter for a given period (total revenue / fleet size) */
export function revenuePerScooter(revenueData, fleetSize) {
  if (!fleetSize) return 0;
  // Use distinct dates to avoid over-counting multi-location rows
  const distinctDates = new Set(revenueData.map((r) => r.date)).size;
  if (!distinctDates) return 0;
  const months = distinctDates / (365 / 12);
  return totalRevenue(revenueData) / fleetSize / months;
}

/**
 * Full revenue breakdown for a period, applying franchise fee, VAT, and SIM deductions.
 *
 * Revenue stored in Firestore (totalPaidRevenue) is NET of VAT — i.e. the ex-VAT amount.
 * Cash-flow identity:
 *   cashReceived = companyShare + vatPortion − simCost
 *   companyShare = gross × (1 − franchiseRate)   [if fee active, else gross]
 *   vatPortion   = gross × vatRate                [collected but owed to government]
 *   simCost      = monthlySimCost × periodMonths
 *   operatingRevenue = companyShare − simCost     [used for P&L and financial health]
 *
 * @param {Array}  revenueRows   - revenue docs for the period
 * @param {Object} financial     - config.financial (defaults applied if falsy)
 * @param {number} periodMonths  - how many months the period spans (default 1)
 */
export function revenueBreakdown(revenueRows, financial, periodMonths = 1) {
  const fin = {
    applyFranchiseFee: true,
    franchiseRate: 0.19,
    vatRate: 0.24,
    monthlySimCost: 150,
    ...(financial || {}),
  };

  const gross = totalRevenue(revenueRows);
  // franchiseExempt rows (e.g. Stripe/XSlide direct revenue) never had a
  // platform cut taken — the fee only ever applies to the feeable portion.
  // When no row carries the flag this is identical to gross * franchiseRate.
  const feeableGross = totalRevenue(revenueRows.filter((r) => !r?.franchiseExempt));
  const hoppFee = fin.applyFranchiseFee ? feeableGross * fin.franchiseRate : 0;
  const companyShare = gross - hoppFee;
  const vatPortion = gross * fin.vatRate;
  const simCost = fin.monthlySimCost * periodMonths;
  const opRevenue = companyShare - simCost;
  const cashReceived = companyShare + vatPortion - simCost;

  return {
    gross,
    hoppFee,
    companyShare,
    vatPortion,
    simCost,
    operatingRevenue: opRevenue,
    cashReceived,
  };
}

/**
 * Scalar shortcut: net operating revenue for the period.
 * This is the number to use for P&L, break-even, and financial health calculations.
 */
export function operatingRevenue(revenueRows, financial, periodMonths = 1) {
  return revenueBreakdown(revenueRows, financial, periodMonths).operatingRevenue;
}

/**
 * Post-process a monthly trend array (from combinedMonthlyTrend / allTimeCombinedTrend)
 * to apply franchise fee and SIM deductions to each month's revenue & profit values.
 * Keeps existing trend functions untouched; adjustment is applied at the call site.
 */
export function applyFinancialAdjustments(trendArray, financial) {
  const fin = {
    applyFranchiseFee: true,
    franchiseRate: 0.19,
    vatRate: 0.24,
    monthlySimCost: 150,
    ...(financial || {}),
  };
  const revenueMultiplier = fin.applyFranchiseFee ? (1 - fin.franchiseRate) : 1;

  return trendArray.map((entry) => {
    // entry.exemptRevenue (franchiseExempt rows, e.g. Stripe/XSlide) skips the
    // multiplier entirely — absent/0 for every pre-existing caller, so this is
    // byte-identical to the old `(entry.revenue||0) * revenueMultiplier` then.
    const totalRev  = entry.revenue || 0;
    const exemptRev = entry.exemptRevenue || 0;
    const feeableRev = totalRev - exemptRev;
    const adjRevenue = parseFloat((feeableRev * revenueMultiplier + exemptRev - fin.monthlySimCost).toFixed(2));
    const adjProfit  = parseFloat((adjRevenue - (entry.total || 0)).toFixed(2));
    return { ...entry, revenue: adjRevenue, profit: adjProfit };
  });
}

/** Profit/loss: revenue minus costs for matching period */
export function profitLoss(revenueData, costs) {
  if (!revenueData.length) return 0;
  const rev = totalRevenue(revenueData);
  // Use the same monthly normalization as the cost side
  const monthlyCost = totalMonthlyCost(costs);
  // Use distinct dates for accurate period length
  const distinctDates = new Set(revenueData.map((r) => r.date)).size;
  const days = distinctDates || 30;
  const months = days / (365 / 12);
  const costForPeriod = monthlyCost * months;
  return rev - costForPeriod;
}

/** Average trips per day */
export function avgTripsPerDay(revenueData) {
  if (!revenueData.length) return 0;
  const total = revenueData.reduce((s, r) => s + (r.totalTrips || 0), 0);
  return total / revenueData.length;
}

/** Revenue per trip */
export function revenuePerTrip(revenueData) {
  const trips = revenueData.reduce((s, r) => s + (r.totalTrips || 0), 0);
  if (!trips) return 0;
  return totalRevenue(revenueData) / trips;
}

/** Vehicle utilization: avg unique vehicles / fleet size × 100, capped at 100 (uniqueVehiclesCount can exceed a stale fleetSize; >100% is nonsensical as a KPI). */
export function vehicleUtilization(revenueData, fleetSize) {
  if (!fleetSize || !revenueData.length) return 0;
  const avgVehicles = revenueData.reduce((s, r) => s + (r.uniqueVehiclesCount || 0), 0) / revenueData.length;
  // Cap at 100%: uniqueVehiclesCount can exceed a stale/undercounted fleetSize,
  // and a KPI reading ">100% utilization" is nonsensical to users. Restored
  // after round-2 bug sweep dropped the cap (caught by revenueCalculations.test.js).
  return Math.min(100, (avgVehicles / fleetSize) * 100);
}

/** Total trip distance across all rows (km) */
export function totalDistanceKm(revenueData) {
  return revenueData.reduce((s, r) => s + (r.totalTripDistanceKm || 0), 0);
}

/** Total trips across all rows */
export function totalTrips(revenueData) {
  return revenueData.reduce((s, r) => s + (r.totalTrips || 0), 0);
}

/**
 * Monthly revenue summary for a given year (default: current year).
 * Returns array of 12 objects: { month, revenue, trips, distance, uniqueUsers, uniqueVehicles }
 */
export function monthlyRevenueSummary(revenueData, year) {
  const y = year || new Date().getFullYear();
  return MONTHS.map((month, i) => {
    const prefix = `${y}-${String(i + 1).padStart(2, '0')}`;
    const rows = revenueData.filter((r) => r.date.startsWith(prefix));
    return {
      month: `${month} ${y}`,
      revenue:        sumCents(rows, (r) => r.totalPaidRevenue),
      // franchiseExempt subtotal (Stripe/XSlide) — feeds applyFinancialAdjustments
      // so the platform fee is deducted only from the feeable portion.
      exemptRevenue:  sumCents(rows.filter((r) => r.franchiseExempt), (r) => r.totalPaidRevenue),
      trips:          rows.reduce((s, r) => s + (r.totalTrips || 0), 0),
      distance:       rows.reduce((s, r) => s + (r.totalTripDistanceKm || 0), 0),
      // #69 — this is an AVERAGE of daily unique user counts, not a true monthly
      // unique count. True monthly unique requires raw user IDs across days.
      avgDailyUniqueUsers: rows.length ? rows.reduce((s, r) => s + (r.uniqueUsersCount || 0), 0) / rows.length : 0,
      uniqueVehicles: rows.length ? rows.reduce((s, r) => s + (r.uniqueVehiclesCount || 0), 0) / rows.length : 0,
    };
  });
}

/**
 * Merge monthly cost trend data with monthly revenue for the combined chart.
 * Matches by full month label ('Jan 2025') to avoid cross-year collisions.
 */
export function combinedMonthlyTrend(costTrendData, revenueData, year) {
  const revSummary = monthlyRevenueSummary(revenueData, year);
  // Build lookup: 'Jan 2025' → summary entry (full label avoids year collision)
  const revByMonth = Object.fromEntries(revSummary.map((r) => [r.month, r]));
  return costTrendData.map((costMonth) => {
    // costMonth.month is already 'Jan 2025' — match directly
    const rev = revByMonth[costMonth.month];
    return {
      ...costMonth,
      revenue: parseFloat(((rev?.revenue) || 0).toFixed(2)),
      exemptRevenue: parseFloat(((rev?.exemptRevenue) || 0).toFixed(2)),
      profit:  parseFloat((((rev?.revenue) || 0) - (costMonth.total || 0)).toFixed(2)),
    };
  });
}

/**
 * Filter revenue rows by location.
 * When locationFilter is null or 'all', returns all rows.
 * When a specific location is chosen, returns only rows tagged to that location.
 */
export function filterRevenueByLocation(revenueData, locationFilter) {
  if (!locationFilter || locationFilter === 'all') return revenueData;
  return revenueData.filter((r) => r.location === locationFilter);
}

/**
 * All-time combined trend spanning from the earliest data point to today.
 * Revenue is looked up by YYYY-MM key, so it works across multiple years
 * without the 3-char abbreviation collision of combinedMonthlyTrend.
 */
export function allTimeCombinedTrend(costs, revenueData) {
  // Find earliest revenue month to extend cost range if needed
  let earliestRevYM = null;
  revenueData.forEach((r) => {
    const ym = r.date.slice(0, 7);
    if (!earliestRevYM || ym < earliestRevYM) earliestRevYM = ym;
  });

  const costTrend = allTimeMonthlyTrendData(costs, earliestRevYM);

  // Build revenue lookup by YYYY-MM (accumulated in integer cents to avoid float drift)
  const revCentsKey = {};
  const exemptCentsKey = {};
  revenueData.forEach((r) => {
    const key = r.date.slice(0, 7);
    revCentsKey[key] = (revCentsKey[key] || 0) + Math.round((r.totalPaidRevenue || 0) * 100);
    if (r.franchiseExempt) {
      exemptCentsKey[key] = (exemptCentsKey[key] || 0) + Math.round((r.totalPaidRevenue || 0) * 100);
    }
  });

  return costTrend.map(({ _key, ...rest }) => {
    const rev = (revCentsKey[_key] || 0) / 100;
    const exemptRev = (exemptCentsKey[_key] || 0) / 100;
    return {
      ...rest,
      revenue: parseFloat(rev.toFixed(2)),
      exemptRevenue: parseFloat(exemptRev.toFixed(2)),
      profit:  parseFloat((rev - (rest.total || 0)).toFixed(2)),
    };
  });
}

/**
 * Actual monthly revenue per scooter (revenue / fleet size for that month).
 * Uses YYYY-MM grouping to correctly handle multi-year data.
 */
export function actualRevenuePerScooterMonthly(revenueData, fleetSize) {
  if (!fleetSize || !revenueData.length) return null;
  // Aggregate by YYYY-MM key to avoid silently dropping prior-year data
  // Accumulated in integer cents to avoid float drift; divided back to EUR at read
  const byMonthCents = {};
  revenueData.forEach((r) => {
    const key = r.date.slice(0, 7);
    byMonthCents[key] = (byMonthCents[key] || 0) + Math.round((r.totalPaidRevenue || 0) * 100);
  });
  const activeMths = Object.values(byMonthCents).map((c) => c / 100).filter((v) => v > 0);
  if (!activeMths.length) return null;
  const avgMonthlyRev = activeMths.reduce((s, v) => s + v, 0) / activeMths.length;
  return avgMonthlyRev / fleetSize;
}

/**
 * Revenue breakdown per city for a given period.
 * Returns array of { city, revenue, trips, activeScooters, revenuePerScooter }
 * sorted by revenue descending.
 *
 * @param {Array}  periodRevenue  - revenue docs already filtered to a time period
 * @param {Array}  scooters       - scooter docs from Firestore (have city + status)
 * @param {Array}  cities         - list of city names to iterate
 */
export function revenuePerCityBreakdown(periodRevenue, scooters, cities) {
  if (!cities || cities.length === 0) return [];

  return cities.map((city) => {
    const cityLower = city.toLowerCase();
    const cityRevenue = periodRevenue.filter(
      (r) => (r.location || '').toLowerCase() === cityLower,
    );
    const revenue = sumCents(cityRevenue, (r) => r.totalPaidRevenue);
    const trips   = cityRevenue.reduce((s, r) => s + (r.totalTrips || 0), 0);

    const cityScooters   = scooters.filter((s) => (s.city || '').toLowerCase() === cityLower);
    const activeScooters = cityScooters.filter((s) => s.status === 'Active').length;
    const totalScooters  = cityScooters.length;

    const revenuePerScooter = activeScooters > 0 ? revenue / activeScooters : null;

    return { city, revenue, trips, activeScooters, totalScooters, revenuePerScooter };
  }).filter((row) => row.revenue > 0 || row.totalScooters > 0)
    .sort((a, b) => b.revenue - a.revenue);
}
