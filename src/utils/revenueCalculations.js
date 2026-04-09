import { MONTHS } from './constants.js';
import { totalMonthlyCost, totalAnnualCost, allTimeMonthlyTrendData } from './calculations.js';

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
  return revenueData.reduce((s, r) => s + (r.totalPaidRevenue || 0), 0);
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
  const days = revenueData.length;
  if (!days) return 0;
  const months = days / 30;
  return totalRevenue(revenueData) / fleetSize / months;
}

/** Profit/loss: revenue minus costs for matching period */
export function profitLoss(revenueData, costs) {
  const rev = totalRevenue(revenueData);
  // Use the same monthly normalization as the cost side
  const monthlyCost = totalMonthlyCost(costs);
  const days = revenueData.length || 30;
  const months = days / 30;
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

/** Vehicle utilization: avg unique vehicles / fleet size × 100 */
export function vehicleUtilization(revenueData, fleetSize) {
  if (!fleetSize || !revenueData.length) return 0;
  const avgVehicles = revenueData.reduce((s, r) => s + (r.uniqueVehiclesCount || 0), 0) / revenueData.length;
  return (avgVehicles / fleetSize) * 100;
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
      revenue:        rows.reduce((s, r) => s + (r.totalPaidRevenue || 0), 0),
      trips:          rows.reduce((s, r) => s + (r.totalTrips || 0), 0),
      distance:       rows.reduce((s, r) => s + (r.totalTripDistanceKm || 0), 0),
      uniqueUsers:    rows.length ? rows.reduce((s, r) => s + (r.uniqueUsersCount || 0), 0) / rows.length : 0,
      uniqueVehicles: rows.length ? rows.reduce((s, r) => s + (r.uniqueVehiclesCount || 0), 0) / rows.length : 0,
    };
  });
}

/**
 * Merge monthly cost trend data with monthly revenue for the combined chart.
 * Matches by 3-char month abbreviation (cost labels are now 'Jan 2025' format).
 */
export function combinedMonthlyTrend(costTrendData, revenueData, year) {
  const revSummary = monthlyRevenueSummary(revenueData, year);
  // Build lookup: 'Jan' → summary entry
  const revByMonth = Object.fromEntries(revSummary.map((r) => [r.month.slice(0, 3), r]));
  return costTrendData.map((costMonth) => {
    // costMonth.month is 'Jan 2025' — extract 3-char abbreviation
    const abbr = costMonth.month.slice(0, 3);
    const rev  = revByMonth[abbr];
    return {
      ...costMonth,
      revenue: parseFloat(((rev?.revenue) || 0).toFixed(2)),
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

  // Build revenue lookup by YYYY-MM
  const revByKey = {};
  revenueData.forEach((r) => {
    const key = r.date.slice(0, 7);
    revByKey[key] = (revByKey[key] || 0) + (r.totalPaidRevenue || 0);
  });

  return costTrend.map(({ _key, ...rest }) => ({
    ...rest,
    revenue: parseFloat((revByKey[_key] || 0).toFixed(2)),
    profit:  parseFloat(((revByKey[_key] || 0) - (rest.total || 0)).toFixed(2)),
  }));
}

/**
 * Actual monthly revenue per scooter (revenue / fleet size for that month).
 */
export function actualRevenuePerScooterMonthly(revenueData, fleetSize) {
  if (!fleetSize || !revenueData.length) return null;
  const monthlyData = monthlyRevenueSummary(revenueData);
  const activeMths = monthlyData.filter((m) => m.revenue > 0);
  if (!activeMths.length) return null;
  const avgMonthlyRev = activeMths.reduce((s, m) => s + m.revenue, 0) / activeMths.length;
  return avgMonthlyRev / fleetSize;
}
