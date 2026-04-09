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
 * Monthly trend data for current year.
 * - X-axis labels show 'Jan 2025' format (not just 'Jan')
 * - Future months with no costs are trimmed
 */
export function monthlyTrendData(costs) {
  const now = new Date();
  const year = now.getFullYear();
  const currentMonthIdx = now.getMonth();

  const all = MONTHS.map((month, i) => {
    const monthDate = new Date(year, i, 1);
    const entry = { month: `${month} ${year}`, _idx: i };

    ['one-off', 'fixed', 'variable', 'investment'].forEach((cat) => {
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
      (entry['investment'] || 0);

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
