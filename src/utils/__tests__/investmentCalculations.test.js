/**
 * Contract tests for investmentCalculations.js — bug #367.
 * Guards the four KPI-grade exports against silent regressions.
 */
import { describe, it, expect } from 'vitest';
import {
  projectCumulativePnL,
  findBreakEvenMonth,
  revenuePerScooterLifetime,
  repairCostPerScooter,
} from '../investmentCalculations.js';

// ─── projectCumulativePnL ────────────────────────────────────────────────────

describe('projectCumulativePnL', () => {
  it('starts negative by the investment amount', () => {
    const series = projectCumulativePnL({ investment: 1000, horizonMonths: 1, monthlyRevenue: 0, monthlyOpex: 0 });
    expect(series[0].cumulative).toBe(-1000);
  });

  it('returns one entry per month', () => {
    const series = projectCumulativePnL({ investment: 0, horizonMonths: 6, monthlyRevenue: 100, monthlyOpex: 50 });
    expect(series).toHaveLength(6);
    series.forEach((s, i) => expect(s.month).toBe(i + 1));
  });

  it('accumulates monthly profit correctly', () => {
    const series = projectCumulativePnL({ investment: 200, horizonMonths: 2, monthlyRevenue: 150, monthlyOpex: 50 });
    // M1: -200 + (150-50) = -100
    expect(series[0].cumulative).toBe(-100);
    // M2: -100 + 100 = 0
    expect(series[1].cumulative).toBe(0);
  });

  it('labels entries M1 M2 …', () => {
    const series = projectCumulativePnL({ investment: 0, horizonMonths: 3, monthlyRevenue: 0, monthlyOpex: 0 });
    expect(series.map((s) => s.label)).toEqual(['M1', 'M2', 'M3']);
  });

  it('returns empty array for 0 horizon', () => {
    expect(projectCumulativePnL({ investment: 100, horizonMonths: 0, monthlyRevenue: 50, monthlyOpex: 20 })).toEqual([]);
  });

  it('each entry carries revenue and opex', () => {
    const [entry] = projectCumulativePnL({ investment: 0, horizonMonths: 1, monthlyRevenue: 300, monthlyOpex: 100 });
    expect(entry.revenue).toBe(300);
    expect(entry.opex).toBe(100);
  });
});

// ─── findBreakEvenMonth ──────────────────────────────────────────────────────

describe('findBreakEvenMonth', () => {
  it('returns the first month cumulative >= 0', () => {
    const series = [
      { month: 1, cumulative: -100 },
      { month: 2, cumulative: -50 },
      { month: 3, cumulative: 10 },
    ];
    expect(findBreakEvenMonth(series)).toBe(3);
  });

  it('returns null when never break-even', () => {
    const series = [
      { month: 1, cumulative: -100 },
      { month: 2, cumulative: -50 },
    ];
    expect(findBreakEvenMonth(series)).toBeNull();
  });

  it('returns month 1 when investment is 0', () => {
    const series = [{ month: 1, cumulative: 0 }];
    expect(findBreakEvenMonth(series)).toBe(1);
  });

  it('returns null for empty series', () => {
    expect(findBreakEvenMonth([])).toBeNull();
  });

  it('works end-to-end with projectCumulativePnL', () => {
    // €600 investment, €100/mo profit → break-even at M6
    const series = projectCumulativePnL({ investment: 600, horizonMonths: 12, monthlyRevenue: 200, monthlyOpex: 100 });
    expect(findBreakEvenMonth(series)).toBe(6);
  });
});

// ─── revenuePerScooterLifetime ───────────────────────────────────────────────

describe('revenuePerScooterLifetime', () => {
  const scooter = { scooterId: 'SC001', purchaseDate: '2025-01-01' };
  const revenue = [
    { date: '2025-01-10', totalPaidRevenue: 100, uniqueVehiclesCount: 2 },
    { date: '2025-01-11', totalPaidRevenue: 80,  uniqueVehiclesCount: 2 },
  ];

  it('returns 0 for empty revenue', () => {
    const result = revenuePerScooterLifetime(scooter, [], []);
    expect(result.total).toBe(0);
    expect(result.monthly).toEqual([]);
  });

  it('returns 0 for null scooter', () => {
    expect(revenuePerScooterLifetime(null, revenue, []).total).toBe(0);
  });

  it('divides daily revenue by active scooters', () => {
    // 100/2 + 80/2 = 90
    const result = revenuePerScooterLifetime(scooter, revenue, []);
    expect(result.total).toBe(90);
  });

  it('skips revenue before purchaseDate', () => {
    const earlyRevenue = [{ date: '2024-12-01', totalPaidRevenue: 999, uniqueVehiclesCount: 1 }];
    expect(revenuePerScooterLifetime(scooter, earlyRevenue, []).total).toBe(0);
  });

  it('skips days when scooter is in repair', () => {
    const ticket = { dateEntered: '2025-01-10', dateCompleted: '2025-01-10' };
    // Only the Jan 11 day counts: 80/2 = 40
    const result = revenuePerScooterLifetime(scooter, revenue, [ticket]);
    expect(result.total).toBe(40);
  });

  it('groups into monthly buckets', () => {
    const result = revenuePerScooterLifetime(scooter, revenue, []);
    expect(result.monthly).toHaveLength(1);
    expect(result.monthly[0].key).toBe('2025-01');
  });
});

// ─── repairCostPerScooter ────────────────────────────────────────────────────

describe('repairCostPerScooter', () => {
  const tickets = [
    {
      scooterId: 'SC001',
      dateEntered: '2025-03-01',
      partsUsed: [{ partId: 'p1', quantity: 2, unitCost: 10 }],
      labourMinutes: 60,
    },
  ];
  const parts = [{ _docId: 'p1', unitCost: 10 }];

  it('returns 0 total for unknown scooter', () => {
    expect(repairCostPerScooter('UNKNOWN', tickets, parts).total).toBe(0);
  });

  it('sums parts cost from partsUsed.unitCost', () => {
    const result = repairCostPerScooter('SC001', tickets, parts);
    expect(result.total).toBe(20); // 2 × €10
  });

  it('adds labour cost when rate is provided', () => {
    // 60 min = 1h at €60/h → €60 labour + €20 parts = €80
    const result = repairCostPerScooter('SC001', tickets, parts, 60);
    expect(result.total).toBe(80);
  });

  it('returns monthly breakdown', () => {
    const result = repairCostPerScooter('SC001', tickets, parts);
    expect(result.monthly).toHaveLength(1);
    expect(result.monthly[0].key).toBe('2025-03');
  });

  it('returns empty arrays for no tickets', () => {
    const result = repairCostPerScooter('SC001', [], []);
    expect(result.total).toBe(0);
    expect(result.monthly).toEqual([]);
  });
});
