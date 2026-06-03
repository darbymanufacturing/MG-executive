import { describe, it, expect } from 'vitest';
import { budgetFromCity } from '../budgetFromCity.js';

// Minimal cost rows (monthly frequency, €100/month each)
const MONTHLY_COSTS = [
  { name: 'Insurance', category: 'insurance', amount: 100, frequency: 'monthly' },
  { name: 'Rental',    category: 'other',     amount: 100, frequency: 'monthly' },
];

describe('budgetFromCity', () => {
  it('returns zero revenue and expenses when costs and revenue are empty', () => {
    const result = budgetFromCity([], [], null);
    expect(result.revenue).toBe(0);
    expect(result.expenses).toBe(0);
    expect(result.net).toBe(0);
  });

  it('returns zero revenue when no city is linked', () => {
    const revenueData = [
      { date: '2026-01-01', location: 'Athens', totalPaidRevenue: 500, totalTrips: 10 },
    ];
    const { revenue } = budgetFromCity(MONTHLY_COSTS, revenueData, null);
    expect(revenue).toBe(0);
  });

  // Bug #509 regression: revenue must be MONTHLY, not cumulative all-time.
  it('normalizes revenue to monthly average (Bug #509 — unit mismatch)', () => {
    // 3 months of revenue rows for Athens: Jan, Feb, Mar 2026 → 300 each
    const revenueData = [
      { date: '2026-01-15', location: 'Athens', totalPaidRevenue: 300, totalTrips: 10 },
      { date: '2026-02-15', location: 'Athens', totalPaidRevenue: 300, totalTrips: 10 },
      { date: '2026-03-15', location: 'Athens', totalPaidRevenue: 300, totalTrips: 10 },
    ];
    const { revenue, expenses, net } = budgetFromCity(MONTHLY_COSTS, revenueData, 'Athens');

    // Span = 3 months → monthly revenue = 900 / 3 = 300
    expect(revenue).toBeCloseTo(300, 5);
    // Monthly expenses = 100 + 100 = 200
    expect(expenses).toBeCloseTo(200, 5);
    // net = 300 - 200 = 100 (NOT 900 - 200 = 700 as the buggy version produced)
    expect(net).toBeCloseTo(100, 5);
  });

  it('returns full monthly revenue when only one month of data exists', () => {
    const revenueData = [
      { date: '2026-05-10', location: 'Thessaloniki', totalPaidRevenue: 400, totalTrips: 8 },
    ];
    const { revenue } = budgetFromCity(MONTHLY_COSTS, revenueData, 'Thessaloniki');
    // spanMonths = 1 → revenue = 400 / 1 = 400
    expect(revenue).toBeCloseTo(400, 5);
  });

  it('filters revenue to the linked city and ignores other locations', () => {
    const revenueData = [
      { date: '2026-01-01', location: 'Athens',        totalPaidRevenue: 500, totalTrips: 10 },
      { date: '2026-01-01', location: 'Thessaloniki',  totalPaidRevenue: 999, totalTrips: 20 },
    ];
    const { revenue } = budgetFromCity([], revenueData, 'Athens');
    // Only Athens row: 500 / 1 month = 500
    expect(revenue).toBeCloseTo(500, 5);
  });

  it('normalizes annual costs to monthly for expenses', () => {
    const annualCost = [
      { name: 'Yearly contract', category: 'other', amount: 1200, frequency: 'annual' },
    ];
    const revenueData = [
      { date: '2026-01-15', location: 'Athens', totalPaidRevenue: 200, totalTrips: 5 },
    ];
    const { expenses } = budgetFromCity(annualCost, revenueData, 'Athens');
    // 1200 / 12 = 100 per month
    expect(expenses).toBeCloseTo(100, 5);
  });

  it('keeps revTransactions and costTransactions in the returned shape', () => {
    const revenueData = [
      { date: '2026-03-01', location: 'Athens', totalPaidRevenue: 100, totalTrips: 2 },
    ];
    const result = budgetFromCity(MONTHLY_COSTS, revenueData, 'Athens');
    expect(Array.isArray(result.revTransactions)).toBe(true);
    expect(Array.isArray(result.costTransactions)).toBe(true);
    expect(result.revTransactions[0].amount).toBe(100); // raw row amount, not normalized
  });

  it('net uses monthly-equivalent revenue, not cumulative (regression guard)', () => {
    // 12 months × 500 = cumulative 6000; monthly avg = 500
    const revenueData = Array.from({ length: 12 }, (_, i) => ({
      date: `2025-${String(i + 1).padStart(2, '0')}-01`,
      location: 'Athens',
      totalPaidRevenue: 500,
      totalTrips: 10,
    }));
    const costs = [
      { name: 'Monthly op', category: 'other', amount: 300, frequency: 'monthly' },
    ];
    const { revenue, net } = budgetFromCity(costs, revenueData, 'Athens');

    // Monthly avg revenue = 6000 / 12 = 500; expenses = 300; net = 200
    expect(revenue).toBeCloseTo(500, 5);
    expect(net).toBeCloseTo(200, 5);
    // Sanity check: the OLD buggy value would have been 6000 - 300 = 5700
    expect(net).not.toBeCloseTo(5700, 0);
  });
});
