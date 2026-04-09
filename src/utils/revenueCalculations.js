import { MONTHS } from './constants.js';
import { totalMonthlyCost, totalAnnualCost } from './calculations.js';

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
      month,
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
  const revByMonth = Object.fromEntries(revSummary.map((r) => [r.month, r]));
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
