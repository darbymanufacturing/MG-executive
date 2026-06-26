import { describe, it, expect } from 'vitest';
import {
  nextOccurrence,
  upcomingForCosts,
  isRecurring,
  isActualCost,
  isCommitment,
  frequencyLabel,
} from '../upcomingPayments.js';

const NOW = new Date(2026, 5, 26); // 2026-06-26 (local midnight)
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('classification helpers', () => {
  it('isRecurring / isActualCost split on frequency', () => {
    expect(isRecurring({ frequency: 'monthly' })).toBe(true);
    expect(isRecurring({ frequency: 'one-time' })).toBe(false);
    expect(isActualCost({ frequency: 'one-time' })).toBe(true);
    expect(isActualCost({ frequency: 'monthly' })).toBe(false);
  });

  it('isCommitment is recurring AND not ended', () => {
    expect(isCommitment({ frequency: 'monthly', startDate: '2026-01-01' }, { now: NOW })).toBe(true);
    expect(isCommitment({ frequency: 'monthly', startDate: '2026-01-01', endDate: '2026-03-01' }, { now: NOW })).toBe(false);
    expect(isCommitment({ frequency: 'one-time', startDate: '2026-06-30' }, { now: NOW })).toBe(false);
  });

  it('frequencyLabel resolves known + unknown', () => {
    expect(frequencyLabel('monthly')).toBe('Monthly');
    expect(frequencyLabel('weird')).toBe('weird');
  });
});

describe('nextOccurrence', () => {
  it('monthly anchors on the start day-of-month', () => {
    const occ = nextOccurrence({ frequency: 'monthly', startDate: '2025-01-15' }, { now: NOW });
    expect(iso(occ)).toBe('2026-07-15'); // next 15th after 2026-06-26
  });

  it('monthly due today counts as due today', () => {
    const occ = nextOccurrence({ frequency: 'monthly', startDate: '2025-01-26' }, { now: NOW });
    expect(iso(occ)).toBe('2026-06-26');
  });

  it('clamps month-end rollover (Jan-31 → Feb-28)', () => {
    const occ = nextOccurrence({ frequency: 'monthly', startDate: '2025-01-31' }, { now: new Date(2026, 1, 1) });
    expect(iso(occ)).toBe('2026-02-28');
  });

  it('future-starting recurring → first charge is the start date', () => {
    const occ = nextOccurrence({ frequency: 'monthly', startDate: '2026-09-10' }, { now: NOW });
    expect(iso(occ)).toBe('2026-09-10');
  });

  it('one-time in the future returns its date; in the past returns null', () => {
    expect(iso(nextOccurrence({ frequency: 'one-time', startDate: '2026-07-01' }, { now: NOW }))).toBe('2026-07-01');
    expect(nextOccurrence({ frequency: 'one-time', startDate: '2026-01-01' }, { now: NOW })).toBeNull();
  });

  it('respects endDate (ended → null; next occurrence past end → null)', () => {
    expect(nextOccurrence({ frequency: 'monthly', startDate: '2025-01-01', endDate: '2026-01-01' }, { now: NOW })).toBeNull();
  });

  it('quarterly steps by 3 months', () => {
    const occ = nextOccurrence({ frequency: 'quarterly', startDate: '2025-02-10' }, { now: NOW });
    // occurrences: Feb, May, Aug 2025 … through 2026: Feb-10, May-10, Aug-10 → next after Jun-26 is Aug-10
    expect(iso(occ)).toBe('2026-08-10');
  });

  it('weekly steps by 7 days to the next on-or-after today', () => {
    const occ = nextOccurrence({ frequency: 'weekly', startDate: '2026-06-01' }, { now: NOW });
    // Jun-01 + 7k: 01,08,15,22,29 → next ≥ Jun-26 is Jun-29
    expect(iso(occ)).toBe('2026-06-29');
  });

  it('daily is due today once started', () => {
    expect(iso(nextOccurrence({ frequency: 'daily', startDate: '2026-01-01' }, { now: NOW }))).toBe('2026-06-26');
  });
});

describe('upcomingForCosts', () => {
  it('includes a monthly commitment due within 30 days, once', () => {
    const costs = [{ id: 'rent', name: 'Shop rent', category: 'fixed', amount: 1200, frequency: 'monthly', startDate: '2025-01-01' }];
    const { items, total } = upcomingForCosts(costs, { horizonDays: 30, now: NOW });
    expect(items).toHaveLength(1);
    expect(items[0].occurrenceCount).toBe(1);
    expect(items[0].horizonTotal).toBe(1200);
    expect(items[0].isEstimate).toBe(false);
    expect(total).toBe(1200);
  });

  it('aggregates a weekly cost over the window and flags it as an estimate', () => {
    const costs = [{ id: 'charge', name: 'Charging', category: 'variable', amount: 100, frequency: 'weekly', startDate: '2026-06-01' }];
    const { items } = upcomingForCosts(costs, { horizonDays: 30, now: NOW });
    // window 2026-06-26..2026-07-26: 06-29, 07-06, 07-13, 07-20 → 4 occurrences (07-27 is outside)
    expect(items[0].occurrenceCount).toBe(4);
    expect(items[0].horizonTotal).toBe(400);
    expect(items[0].isEstimate).toBe(true);
  });

  it('includes a future one-time inside the horizon, excludes one past/beyond', () => {
    const costs = [
      { id: 'a', name: 'Deposit', category: 'one-off', amount: 500, frequency: 'one-time', startDate: '2026-07-05' },
      { id: 'b', name: 'Old', category: 'one-off', amount: 99, frequency: 'one-time', startDate: '2026-01-01' },
      { id: 'c', name: 'Far', category: 'one-off', amount: 99, frequency: 'one-time', startDate: '2026-12-01' },
    ];
    const { items } = upcomingForCosts(costs, { horizonDays: 30, now: NOW });
    expect(items.map((i) => i.id)).toEqual(['a']);
  });

  it('sorts by next due date and totals + groups by category', () => {
    const costs = [
      { id: 'rent', name: 'Rent', category: 'fixed', amount: 1200, frequency: 'monthly', startDate: '2025-07-01' },
      { id: 'loan', name: 'Loan', category: 'loan', amount: 400, frequency: 'monthly', startDate: '2025-06-28' },
    ];
    const { items, total, byCategory } = upcomingForCosts(costs, { horizonDays: 30, now: NOW });
    expect(items.map((i) => i.id)).toEqual(['loan', 'rent']); // 06-28 before 07-01
    expect(total).toBe(1600);
    expect(byCategory).toEqual({ loan: 400, fixed: 1200 });
  });

  it('skips ended commitments and zero-amount rows', () => {
    const costs = [
      { id: 'ended', name: 'Old sub', category: 'fixed', amount: 50, frequency: 'monthly', startDate: '2024-01-01', endDate: '2025-01-01' },
      { id: 'zero', name: 'Free', category: 'fixed', amount: 0, frequency: 'monthly', startDate: '2025-01-01' },
    ];
    const { items } = upcomingForCosts(costs, { horizonDays: 30, now: NOW });
    expect(items).toHaveLength(0);
  });
});
