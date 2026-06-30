import { describe, it, expect } from 'vitest';
import {
  nextOccurrence,
  upcomingForCosts,
  isRecurring,
  isActualCost,
  isCommitment,
  frequencyLabel,
  nextUnsettledOccurrence,
  settledThisMonth,
  settlementStatusFor,
  periodKeyOf,
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

  it('counts daily occurrences across the full inclusive window (DST-safe calendar step)', () => {
    // start in Jan (winter) viewed in Jun (summer): fixed-ms stepping would land at 01:00
    // and drop the last day → 30; calendar-day stepping correctly yields 31 in any TZ.
    const costs = [{ id: 'd', name: 'Charging', category: 'variable', amount: 10, frequency: 'daily', startDate: '2026-01-01' }];
    const { items } = upcomingForCosts(costs, { horizonDays: 30, now: NOW });
    expect(items[0].occurrenceCount).toBe(31); // 2026-06-26 .. 2026-07-26 inclusive
    expect(items[0].horizonTotal).toBe(310);
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

describe('settlement ledger (ADR-0027)', () => {
  // Due on the 28th → next occurrence (from June 26) is June 28, still ahead of "today".
  const rent28 = {
    id: 'r28', name: 'Rent', category: 'Space rent', frequency: 'monthly',
    amount: 200, startDate: '2026-01-28',
    settlements: { '2026-06': { status: 'paid', at: '2026-06-02T00:00:00Z' } },
  };
  const starlink = {
    id: 'sl', name: 'Starlink', category: 'SW subscriptions, Telco charges', frequency: 'monthly',
    amount: 40, startDate: '2026-01-28',
    settlements: { '2026-06': { status: 'committed', at: '2026-06-01T00:00:00Z' } },
  };
  const loan = {
    id: 'ln', name: 'Loan', category: 'Bank loans', frequency: 'monthly',
    amount: 400, startDate: '2026-01-28', // unsettled
  };

  it('periodKeyOf + settlementStatusFor read the occurrence month', () => {
    expect(periodKeyOf(new Date(2026, 5, 28))).toBe('2026-06');
    expect(settlementStatusFor(rent28, new Date(2026, 5, 28))).toBe('paid');   // June
    expect(settlementStatusFor(rent28, new Date(2026, 6, 28))).toBe(null);     // July (none)
  });

  it('nextUnsettledOccurrence skips a settled month', () => {
    expect(iso(nextOccurrence(rent28, { now: NOW }))).toBe('2026-06-28');           // raw next = this month
    expect(iso(nextUnsettledOccurrence(rent28, { now: NOW }))).toBe('2026-07-28');  // June paid → advance
    expect(iso(nextUnsettledOccurrence(loan, { now: NOW }))).toBe('2026-06-28');    // unsettled → unchanged
  });

  it('upcomingForCosts drops settled occurrences from the total', () => {
    const ctrl = { ...rent28, id: 'ctrl', settlements: undefined };
    const settled = upcomingForCosts([rent28], { horizonDays: 35, now: NOW });   // window → 2026-07-31
    const control = upcomingForCosts([ctrl], { horizonDays: 35, now: NOW });
    expect(control.items[0].horizonTotal).toBe(400);                  // June 28 + July 28
    expect(settled.items[0].horizonTotal).toBe(200);                 // June excluded → July only
    expect(iso(settled.items[0].nextDue)).toBe('2026-07-28');
    expect(settled.items[0].period).toBe('2026-07');
  });

  it('settledThisMonth groups committed + paid for the current month', () => {
    const res = settledThisMonth([rent28, starlink, loan], { now: NOW });
    expect(res.period).toBe('2026-06');
    expect(res.paid.map((p) => p.id)).toEqual(['r28']);
    expect(res.committed.map((c) => c.id)).toEqual(['sl']);
    expect(res.paidTotal).toBe(200);
    expect(res.committedTotal).toBe(40);
  });

  it('settledThisMonth includes near-future months in the window (month-end case)', () => {
    // Late June: an item ticked now lands in July → must still show under "Handled".
    const julyCommit = {
      id: 'jl', name: 'Rent', category: 'Space rent', frequency: 'monthly', amount: 155,
      settlements: { '2026-07': { status: 'committed', at: '2026-06-26T00:00:00Z' } },
    };
    const res = settledThisMonth([julyCommit], { now: NOW, horizonDays: 30 }); // window [2026-06, 2026-07]
    expect(res.committed).toHaveLength(1);
    expect(res.committed[0].monthLabel).toBe('Jul');
    // beyond the horizon (August) is excluded
    const augCommit = { ...julyCommit, id: 'au', settlements: { '2026-08': { status: 'committed', at: 'x' } } };
    expect(settledThisMonth([augCommit], { now: NOW, horizonDays: 30 }).committed).toHaveLength(0);
  });
});
