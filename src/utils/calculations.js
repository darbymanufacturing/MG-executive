import { FREQUENCIES, MONTHS } from './constants.js';
import { todayISO } from './formatters.js';

/** Normalise a cost entry to its monthly EUR equivalent */
export function normalizeToMonthly(cost) {
  const freq = FREQUENCIES[cost.frequency];
  if (!freq) return 0;
  return cost.amount * freq.monthlyMultiplier;
}

/** Normalise to annual EUR value */
export function normalizeToAnnual(cost) {
  const freq = FREQUENCIES[cost.frequency];
  if (!freq) return 0;
  return cost.amount * freq.annualMultiplier;
}

/** Sum of all recurring monthly costs (one-time excluded from recurring) */
export function totalMonthlyCost(costs) {
  return costs.reduce((sum, c) => sum + normalizeToMonthly(c), 0);
}

/** Sum of all costs on an annual basis (one-time counted once) */
export function totalAnnualCost(costs) {
  return costs.reduce((sum, c) => sum + normalizeToAnnual(c), 0);
}

/** Cost per scooter per month */
export function costPerScooterMonthly(costs, fleetSize) {
  if (!fleetSize || fleetSize === 0) return 0;
  return totalMonthlyCost(costs) / fleetSize;
}

/** Cost per scooter per day (~30 days) */
export function costPerScooterDaily(costs, fleetSize) {
  return costPerScooterMonthly(costs, fleetSize) / 30;
}

/** Cost per scooter annually */
export function costPerScooterAnnual(costs, fleetSize) {
  if (!fleetSize || fleetSize === 0) return 0;
  return totalAnnualCost(costs) / fleetSize;
}

/** Break down monthly costs by category */
export function breakdownByCategory(costs) {
  return costs.reduce((acc, c) => {
    const key = c.category;
    acc[key] = (acc[key] || 0) + normalizeToMonthly(c);
    return acc;
  }, {});
}

/** Break down annual costs by category */
export function annualBreakdownByCategory(costs) {
  return costs.reduce((acc, c) => {
    const key = c.category;
    acc[key] = (acc[key] || 0) + normalizeToAnnual(c);
    return acc;
  }, {});
}

/**
 * Filter costs by location.
 * Fleet-wide costs (location null/undefined) are always included.
 * When locationFilter is null or 'all', returns all costs.
 */
export function filterCostsByLocation(costs, locationFilter) {
  if (!locationFilter || locationFilter === 'all') return costs;
  return costs.filter((c) => !c.location || c.location === locationFilter);
}

/**
 * Monthly trend data for a given year (defaults to current year).
 * - X-axis labels show 'Jan 2025' format (not just 'Jan')
 * - Future months with no costs are trimmed (only for current year)
 */
export function monthlyTrendData(costs, year = new Date().getFullYear()) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthIdx = year === currentYear ? now.getMonth() : 11;

  const all = MONTHS.map((month, i) => {
    const monthDate = new Date(year, i, 1);
    const entry = { month: `${month} ${year}`, _idx: i };

    ['one-off', 'fixed', 'variable', 'investment', 'loan', 'credit-card'].forEach((cat) => {
      let total = 0;
      costs.forEach((c) => {
        if (c.category !== cat) return;
        const start = c.startDate ? new Date(c.startDate) : null;
        const end = c.endDate ? new Date(c.endDate) : null;

        if (c.frequency === 'one-time') {
          if (start && start.getFullYear() === year && start.getMonth() === i) {
            total += c.amount;
          }
        } else {
          const activeFrom = start ? start <= new Date(year, i + 1, 0) : true;
          const activeTo = end ? end >= monthDate : true;
          if (activeFrom && activeTo) {
            total += normalizeToMonthly(c);
          }
        }
      });
      entry[cat] = parseFloat(total.toFixed(2));
    });

    entry.total =
      (entry['one-off'] || 0) +
      (entry['fixed'] || 0) +
      (entry['variable'] || 0) +
      (entry['investment'] || 0) +
      (entry['loan'] || 0) +
      (entry['credit-card'] || 0);

    return entry;
  });

  // Keep months up to and including current month, plus past months that have data
  return all
    .filter((e) => e._idx <= currentMonthIdx || e.total > 0)
    .map(({ _idx, ...rest }) => rest); // strip internal _idx
}

/** Returns 'active' | 'past' | 'future' based on cost start/end dates vs today */
export function getCostStatus(cost) {
  const today = todayISO();
  if (cost.startDate && cost.startDate > today) return 'future';
  if (cost.endDate   && cost.endDate   < today) return 'past';
  return 'active';
}

/** What-if: cost per scooter at a different fleet size */
export function projectedCostPerScooter(costs, newFleetSize) {
  if (!newFleetSize || newFleetSize === 0) return 0;
  const fixedMonthly = costs
    .filter((c) => c.category === 'fixed' || c.category === 'investment')
    .reduce((s, c) => s + normalizeToMonthly(c), 0);
  const variableMonthly = costs
    .filter((c) => c.category === 'variable' || c.category === 'one-off')
    .reduce((s, c) => s + normalizeToMonthly(c), 0);
  // Fixed costs stay the same regardless of fleet size; variable scale per scooter
  const currentFleetSize = costs.length > 0 ? null : 1; // handled by caller
  return (fixedMonthly + variableMonthly * newFleetSize) / newFleetSize;
}

/** Simpler projection used by the slider: fixed stays, variable per scooter is kept constant */
export function projectedCostPerScooterSimple(costs, currentFleetSize, newFleetSize) {
  if (!newFleetSize || newFleetSize === 0) return 0;
  const fixedTotal = costs
    .filter((c) => ['fixed', 'investment'].includes(c.category))
    .reduce((s, c) => s + normalizeToMonthly(c), 0);
  const variableTotal = costs
    .filter((c) => ['variable', 'one-off'].includes(c.category))
    .reduce((s, c) => s + normalizeToMonthly(c), 0);
  const variablePerScooter = currentFleetSize > 0 ? variableTotal / currentFleetSize : 0;
  return (fixedTotal + variablePerScooter * newFleetSize) / newFleetSize;
}

/** Budget status: how far actual is from target (negative = under budget ✓) */
export function budgetVariance(actual, target) {
  if (!target || target === 0) return null;
  return ((actual - target) / target) * 100;
}

const ALL_CATS = ['one-off', 'fixed', 'variable', 'investment', 'loan', 'credit-card'];

/**
 * Multi-year monthly trend data spanning from the earliest cost/revenue date to today.
 * Optional startYM ('YYYY-MM') to force an earlier start (e.g. when revenue predates costs).
 * Each entry includes a _key field ('YYYY-MM') for revenue lookup.
 */
export function allTimeMonthlyTrendData(costs, startYM = null) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed

  let startYear = currentYear;
  let startMonthIdx = currentMonth;

  // Find earliest from cost start dates
  costs.forEach((c) => {
    if (c.startDate) {
      const d = new Date(c.startDate);
      const y = d.getFullYear();
      const m = d.getMonth();
      if (y < startYear || (y === startYear && m < startMonthIdx)) {
        startYear = y;
        startMonthIdx = m;
      }
    }
  });

  // Override with caller-provided earliest if it's earlier
  if (startYM) {
    const [sy, sm] = startYM.split('-').map(Number);
    const smIdx = sm - 1;
    if (sy < startYear || (sy === startYear && smIdx < startMonthIdx)) {
      startYear = sy;
      startMonthIdx = smIdx;
    }
  }

  const results = [];
  let y = startYear;
  let m = startMonthIdx;

  while (y < currentYear || (y === currentYear && m <= currentMonth)) {
    const monthDate = new Date(y, m, 1);
    const entry = {
      month: `${MONTHS[m]} ${y}`,
      _key: `${y}-${String(m + 1).padStart(2, '0')}`,
    };

    ALL_CATS.forEach((cat) => {
      let total = 0;
      costs.forEach((c) => {
        if (c.category !== cat) return;
        const start = c.startDate ? new Date(c.startDate) : null;
        const end   = c.endDate   ? new Date(c.endDate)   : null;
        if (c.frequency === 'one-time') {
          if (start && start.getFullYear() === y && start.getMonth() === m) total += c.amount;
        } else {
          const activeFrom = start ? start <= new Date(y, m + 1, 0) : true;
          const activeTo   = end   ? end   >= monthDate              : true;
          if (activeFrom && activeTo) total += normalizeToMonthly(c);
        }
      });
      entry[cat] = parseFloat(total.toFixed(2));
    });

    entry.total = ALL_CATS.reduce((s, k) => s + (entry[k] || 0), 0);
    results.push(entry);

    m++;
    if (m > 11) { m = 0; y++; }
  }

  return results;
}
