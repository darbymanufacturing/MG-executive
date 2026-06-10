import { describe, test, expect } from 'vitest';
import { financialSummary } from '../financialSummary.js';
import { totalAnnualCost } from '../calculations.js';

// A fixed clock so MTD / "active this month" filters are deterministic.
// June 2026 — matches the project's current-date frame.
const NOW = new Date(2026, 5, 15); // 2026-06-15 (month index 5 = June)
const MONTH = { mode: 'month', monthKey: '2026-06', months: 1 };
const OPTS = { now: NOW };

const FIN = {
  applyFranchiseFee: true,
  franchiseRate: 0.19,
  vatRate: 0.24,
  monthlySimCost: 150,
};
const CONFIG = { fleetSize: 10, financial: FIN, locations: [] };

// ─────────────────────────────────────────────────────────────────────────────
// 1. Recurring costs active this month → normalizeToMonthly (monthly×1, quarterly×1/3);
//    included even though they started earlier (#603 guard).
// ─────────────────────────────────────────────────────────────────────────────
describe('1. recurring active-this-month → normalizeToMonthly, started-earlier included', () => {
  test('monthly counts ×1, quarterly counts ×1/3, both started before this month', () => {
    const costs = [
      { amount: 1000, frequency: 'monthly', category: 'fixed', startDate: '2025-01-01' },
      { amount: 300, frequency: 'quarterly', category: 'variable', startDate: '2024-06-01' },
    ];
    const s = financialSummary(costs, [], [], CONFIG, MONTH, OPTS);
    // 1000 × 1 + 300 × (1/3) = 1100
    expect(s.monthlyCostRate).toBeCloseTo(1100);
    // both recurring rows are present in the period set (started earlier, still active)
    expect(s._inputs.periodCostCount).toBe(2);
    expect(s.oneTimeInPeriod).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. One-time dated this month → oneTimeInPeriod + displayTotal, NOT monthlyCostRate;
//    other-month one-time excluded.
// ─────────────────────────────────────────────────────────────────────────────
describe('2. one-time dated this month → oneTimeInPeriod/displayTotal not monthlyCostRate', () => {
  test('this-month one-time lands in oneTimeInPeriod + displayTotal; other-month excluded', () => {
    const costs = [
      { amount: 500, frequency: 'monthly', category: 'fixed', startDate: '2026-01-01' },
      { amount: 2000, frequency: 'one-time', category: 'one-off', startDate: '2026-06-10' },
      { amount: 9999, frequency: 'one-time', category: 'one-off', startDate: '2026-03-10' },
    ];
    const s = financialSummary(costs, [], [], CONFIG, MONTH, OPTS);
    expect(s.monthlyCostRate).toBeCloseTo(500); // one-time contributes 0 to the rate
    expect(s.oneTimeInPeriod).toBe(2000); // only the June one-time
    // displayTotal = 500 × 1 month + 2000 = 2500
    expect(s.displayTotal).toBeCloseTo(2500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. annualTotal === monthlyCostRate × 12; +400 one-time rows leave it unchanged
//    (#601 guard) — contrast totalAnnualCost ballooning.
// ─────────────────────────────────────────────────────────────────────────────
describe('3. annualTotal = monthlyCostRate × 12, immune to one-time rows (#601)', () => {
  test('400 imported one-time rows do not inflate annualTotal, but DO inflate totalAnnualCost', () => {
    const recurring = [
      { amount: 1000, frequency: 'monthly', category: 'fixed', startDate: '2026-01-01' },
    ];
    const oneTimes = Array.from({ length: 400 }, () => ({
      amount: 500,
      frequency: 'one-time',
      category: 'credit-card',
      startDate: '2026-02-15',
    }));
    const sBase = financialSummary(recurring, [], [], CONFIG, MONTH, OPTS);
    const sFlooded = financialSummary([...recurring, ...oneTimes], [], [], CONFIG, MONTH, OPTS);

    expect(sBase.annualTotal).toBeCloseTo(12000); // 1000 × 12
    // adding 400 one-time rows leaves the annual run-rate untouched
    expect(sFlooded.annualTotal).toBeCloseTo(12000);
    // contrast: totalAnnualCost balloons because one-time annualMultiplier = 1
    expect(totalAnnualCost([...recurring, ...oneTimes])).toBeCloseTo(12000 + 400 * 500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Per-scooter on LIVE count (3 active → /3, fleetSizeEffective=3, config.fleetSize
//    ignored; 0 scooters → config fallback).
// ─────────────────────────────────────────────────────────────────────────────
describe('4. per-scooter uses live fleet count; falls back to config when empty', () => {
  test('3 live scooters → effective 3, config.fleetSize=10 ignored', () => {
    const costs = [
      { amount: 900, frequency: 'monthly', category: 'fixed', startDate: '2026-01-01' },
    ];
    const scooters = [
      { scooterId: 'a', status: 'Active', city: 'Nafplio' },
      { scooterId: 'b', status: 'Active', city: 'Nafplio' },
      { scooterId: 'c', status: 'In Repair', city: 'Corinth' },
    ];
    const s = financialSummary(costs, [], scooters, CONFIG, MONTH, OPTS);
    expect(s.liveFleetSize).toBe(3);
    expect(s.fleetSizeEffective).toBe(3);
    expect(s.perScooterMonthly).toBeCloseTo(300); // 900 / 3
    expect(s.scooterCountTotal).toBe(3);
    expect(s.scooterCountActive).toBe(2); // status === 'Active'
  });

  test('0 scooters → fleetSizeEffective falls back to config.fleetSize', () => {
    const costs = [
      { amount: 1000, frequency: 'monthly', category: 'fixed', startDate: '2026-01-01' },
    ];
    const s = financialSummary(costs, [], [], CONFIG, MONTH, OPTS);
    expect(s.liveFleetSize).toBeNull();
    expect(s.fleetSizeEffective).toBe(10); // config.fleetSize
    expect(s.perScooterMonthly).toBeCloseTo(100); // 1000 / 10
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. `yearly` ≠ €0: {1200, yearly} → 100/mo + 1200/yr; identical with `annual`.
// ─────────────────────────────────────────────────────────────────────────────
describe('5. yearly frequency is not €0 and matches annual', () => {
  test('1200 yearly → 100/mo run-rate + 1200 annual', () => {
    const costs = [
      { amount: 1200, frequency: 'yearly', category: 'fixed', startDate: '2026-01-01' },
    ];
    const s = financialSummary(costs, [], [], CONFIG, MONTH, OPTS);
    expect(s.monthlyCostRate).toBeCloseTo(100); // 1200 × (1/12)
    expect(s.annualTotal).toBeCloseTo(1200); // 100 × 12
  });

  test('annual frequency gives identical figures to yearly', () => {
    const yearly = financialSummary(
      [{ amount: 1200, frequency: 'yearly', category: 'fixed', startDate: '2026-01-01' }],
      [], [], CONFIG, MONTH, OPTS,
    );
    const annual = financialSummary(
      [{ amount: 1200, frequency: 'annual', category: 'fixed', startDate: '2026-01-01' }],
      [], [], CONFIG, MONTH, OPTS,
    );
    expect(yearly.monthlyCostRate).toBeCloseTo(annual.monthlyCostRate);
    expect(yearly.annualTotal).toBeCloseTo(annual.annualTotal);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Fleet-scoped subset sums + untagged-overhead-included-everywhere rule asserted.
//    (financialSummary consumes ALREADY-scoped arrays — this locks that a per-fleet
//    subset sums to its own total, and that overhead handed to every fleet is counted.)
// ─────────────────────────────────────────────────────────────────────────────
describe('6. fleet-scoped subset sums; shared overhead counted in every fleet view', () => {
  test('per-fleet costs sum to the fleet rate; untagged overhead appears in each scope', () => {
    // Overhead is "unassigned" (no fleet identity) → FleetContext includes it in every
    // fleet view (#562). The selector just sums whatever it is handed, so we model the
    // two scoped inputs the provider would produce.
    const overhead = { amount: 1000, frequency: 'monthly', category: 'fixed', startDate: '2026-01-01' };
    const nafplioCost = { amount: 400, frequency: 'monthly', category: 'variable', startDate: '2026-01-01', city: 'Nafplio' };
    const corinthCost = { amount: 600, frequency: 'monthly', category: 'variable', startDate: '2026-01-01', city: 'Corinth' };

    // Provider hands each fleet view its own costs + shared overhead.
    const nafplioScoped = [overhead, nafplioCost];
    const corinthScoped = [overhead, corinthCost];

    const sN = financialSummary(nafplioScoped, [], [], CONFIG, MONTH, OPTS);
    const sC = financialSummary(corinthScoped, [], [], CONFIG, MONTH, OPTS);

    expect(sN.monthlyCostRate).toBeCloseTo(1400); // 1000 overhead + 400
    expect(sC.monthlyCostRate).toBeCloseTo(1600); // 1000 overhead + 600
    // Σ(fleets) double-counts the shared overhead by design (#562) — the all-fleets view
    // would count it once. This asserts the documented overlap.
    const allFleetsRate = financialSummary(
      [overhead, nafplioCost, corinthCost], [], [], CONFIG, MONTH, OPTS,
    ).monthlyCostRate;
    expect(allFleetsRate).toBeCloseTo(2000); // overhead once + 400 + 600
    expect(sN.monthlyCostRate + sC.monthlyCostRate).toBeCloseTo(allFleetsRate + 1000); // overhead counted twice
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Revenue identities: operatingRevenue === companyShare − simCost;
//    companyShare === gross × (1 − franchiseRate) under applyFranchiseFee.
// ─────────────────────────────────────────────────────────────────────────────
describe('7. revenue breakdown identities', () => {
  test('operatingRevenue = companyShare − simCost; companyShare = gross × (1 − rate)', () => {
    const revenue = [
      { date: '2026-06-01', totalPaidRevenue: 5000, totalTrips: 100 },
      { date: '2026-06-02', totalPaidRevenue: 5000, totalTrips: 100 },
    ];
    const s = financialSummary([], revenue, [], CONFIG, MONTH, OPTS);
    const { gross, hoppFee, companyShare, simCost, operatingRevenue } = s.revenue;
    expect(gross).toBeCloseTo(10000);
    expect(companyShare).toBeCloseTo(gross * (1 - FIN.franchiseRate)); // 10000 × 0.81 = 8100
    expect(hoppFee).toBeCloseTo(gross * FIN.franchiseRate); // 1900
    expect(simCost).toBeCloseTo(FIN.monthlySimCost * 1); // 150 × 1 month
    expect(operatingRevenue).toBeCloseTo(companyShare - simCost); // 8100 − 150 = 7950
    // displayPnL with no costs = operatingRevenue
    expect(s.displayPnL).toBeCloseTo(operatingRevenue);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Empty/zero guards (no throws; per-scooter 0 at 0 scooters; months=0 guard).
// ─────────────────────────────────────────────────────────────────────────────
describe('8. empty/zero guards', () => {
  test('fully empty inputs return zeros, no throw', () => {
    const emptyCfg = { fleetSize: 0, financial: FIN, locations: [] };
    let s;
    expect(() => { s = financialSummary([], [], [], emptyCfg, MONTH, OPTS); }).not.toThrow();
    expect(s.monthlyCostRate).toBe(0);
    expect(s.displayTotal).toBe(0);
    expect(s.annualTotal).toBe(0);
    // 0 scooters + config.fleetSize 0 → per-scooter guarded to 0 (calculations.js:30)
    expect(s.perScooterMonthly).toBe(0);
    expect(s.perScooterDaily).toBe(0);
    expect(s.revenue.gross).toBe(0);
    // With no revenue, operatingRevenue still subtracts the SIM cost (150 × 1 month) —
    // this mirrors the live Dashboard, which always passes periodMonths to revenueBreakdown.
    expect(s.revenue.operatingRevenue).toBeCloseTo(-150);
    expect(s.displayPnL).toBeCloseTo(-150); // operatingRevenue(−150) − displayTotal(0)
    expect(s._inputs.costCount).toBe(0);
  });

  test('months=0 in range mode does not throw and zeroes the period contribution', () => {
    const costs = [
      { amount: 1000, frequency: 'monthly', category: 'fixed', startDate: '2026-01-01' },
    ];
    const period = { mode: 'range', from: '2026-06', to: '2026-06', months: 0 };
    let s;
    expect(() => { s = financialSummary(costs, [], [], CONFIG, period, OPTS); }).not.toThrow();
    // displayTotal = rate × 0 + oneTime(0) = 0; annualTotal still run-rate × 12
    expect(s.displayTotal).toBeCloseTo(0);
    expect(s.annualTotal).toBeCloseTo(12000);
  });

  test('handles null/undefined arrays defensively', () => {
    let s;
    expect(() => { s = financialSummary(null, undefined, null, CONFIG, MONTH, OPTS); }).not.toThrow();
    expect(s.monthlyCostRate).toBe(0);
    expect(s.scooterCountTotal).toBe(0);
  });
});
