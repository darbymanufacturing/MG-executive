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
  currentCosts,
  isActiveInMonth,
  occurrencesInMonth,
  monthPayments,
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

describe('month membership + the cash view (#711 / #712)', () => {
  const monthly = (startDate, endDate) => ({ amount: 100, frequency: 'monthly', startDate, endDate });

  it('currentCosts drops ended commitments and keeps one-time records + future starts', () => {
    const now = new Date(2026, 9, 4);
    const rows = [
      { id: 'ended', frequency: 'monthly', startDate: '2025-01-01', endDate: '2026-10-03' },
      { id: 'endsToday', frequency: 'monthly', startDate: '2025-01-01', endDate: '2026-10-04' },
      { id: 'future', frequency: 'monthly', startDate: '2026-12-01' },
      { id: 'record', frequency: 'one-time', startDate: '2024-05-05' },
    ];
    expect(currentCosts(rows, { now }).map((c) => c.id)).toEqual(['endsToday', 'future', 'record']);
    expect(currentCosts(null)).toEqual([]);
  });

  it('a monthly cost belongs to a month only while it is running on its billing day', () => {
    expect(isActiveInMonth(monthly('2026-06-15', '2026-10-01'), 2026, 9)).toBe(false); // ended before the 15th
    expect(isActiveInMonth(monthly('2026-06-15', '2026-10-15'), 2026, 9)).toBe(true);  // ends ON the billing day
    expect(isActiveInMonth(monthly('2026-06-15', '2026-10-14'), 2026, 9)).toBe(false);
    expect(isActiveInMonth(monthly('2026-06-15', '2026-10-01'), 2026, 8)).toBe(true);  // September was billed
    expect(isActiveInMonth(monthly('2026-06-15'), 2026, 4)).toBe(false);               // not started yet
    expect(isActiveInMonth(monthly('2026-06-15'), 2026, 5)).toBe(true);                // its first month
    expect(isActiveInMonth(monthly(undefined), 2026, 5)).toBe(true);                   // undated = always on
  });

  it('clamps the billing day to short months', () => {
    expect(isActiveInMonth(monthly('2025-01-31', '2026-02-27'), 2026, 1)).toBe(false); // bills 28 Feb
    expect(isActiveInMonth(monthly('2025-01-31', '2026-02-28'), 2026, 1)).toBe(true);
  });

  it('smoothed (quarterly) and day-based (weekly) costs keep sensible boundaries', () => {
    const quarterly = { amount: 300, frequency: 'quarterly', startDate: '2026-01-15', endDate: '2026-10-01' };
    expect(isActiveInMonth(quarterly, 2026, 8)).toBe(true);
    expect(isActiveInMonth(quarterly, 2026, 9)).toBe(false);
    const weekly = { amount: 10, frequency: 'weekly', startDate: '2026-01-01', endDate: '2026-10-02' };
    expect(isActiveInMonth(weekly, 2026, 9)).toBe(true);   // two days of October are inside the run
    expect(isActiveInMonth(weekly, 2026, 10)).toBe(false);
  });

  it('one-time rows belong to their own month, and an ISO timestamp is still a date', () => {
    expect(isActiveInMonth({ frequency: 'one-time', startDate: '2026-10-09' }, 2026, 9)).toBe(true);
    expect(isActiveInMonth({ frequency: 'one-time', startDate: '2026-10-09T08:30:00Z' }, 2026, 9)).toBe(true);
    expect(isActiveInMonth({ frequency: 'one-time', startDate: '2026-09-30' }, 2026, 9)).toBe(false);
    expect(isActiveInMonth({ frequency: 'one-time' }, 2026, 9)).toBe(false);
  });

  it('occurrencesInMonth counts the dated charges inside the month and the run', () => {
    expect(occurrencesInMonth(monthly('2026-06-15'), 2026, 9)).toBe(1);
    expect(occurrencesInMonth(monthly('2026-06-15', '2026-10-01'), 2026, 9)).toBe(0);
    expect(occurrencesInMonth(monthly('2026-11-10'), 2026, 9)).toBe(0); // starts later
    const quarterly = { amount: 300, frequency: 'quarterly', startDate: '2026-01-15' };
    expect(occurrencesInMonth(quarterly, 2026, 9)).toBe(1);  // 15 Oct
    expect(occurrencesInMonth(quarterly, 2026, 10)).toBe(0); // nothing in November
    const weekly = { amount: 10, frequency: 'weekly', startDate: '2026-10-01' };
    expect(occurrencesInMonth(weekly, 2026, 9)).toBe(5);     // 1, 8, 15, 22, 29 Oct
    expect(occurrencesInMonth({ ...weekly, endDate: '2026-10-16' }, 2026, 9)).toBe(3);
    expect(occurrencesInMonth({ frequency: 'one-time', amount: 5, startDate: '2026-10-31' }, 2026, 9)).toBe(1);
    expect(occurrencesInMonth({ frequency: 'monthly', amount: 5 }, 2026, 9)).toBe(0); // undated: no dated charge
  });

  it('monthPayments: due is what falls in the month; paid needs a tick or an actual record', () => {
    const now = new Date(2026, 9, 4);
    const costs = [
      { id: 'rent', amount: 300, frequency: 'monthly', category: 'fixed', startDate: '2026-07-01' },
      { id: 'loan', amount: 250, frequency: 'monthly', category: 'debt', startDate: '2025-04-04',
        settlements: { '2026-10': { status: 'paid', at: 'x' } } },
      { id: 'lease', amount: 600, frequency: 'monthly', category: 'fixed', startDate: '2026-06-15', endDate: '2026-10-01' },
      // the old string form of a tick
      { id: 'legacyTick', amount: 80, frequency: 'monthly', category: 'fixed', startDate: '2026-01-09',
        settlements: { '2026-10': 'paid' } },
      { id: 'fee', amount: 40, frequency: 'one-time', category: 'fees', startDate: '2026-10-02' },
      { id: 'invoice', amount: 100, frequency: 'one-time', category: 'fees', startDate: '2026-10-20' },
      { id: 'zero', amount: 0, frequency: 'monthly', category: 'fixed', startDate: '2026-01-01' },
    ];
    const r = monthPayments(costs, { now });
    expect(r.period).toBe('2026-10');
    expect(r.dueTotal).toBeCloseTo(300 + 250 + 80 + 40 + 100);
    expect(r.dueCount).toBe(5);
    expect(r.paidTotal).toBeCloseTo(250 + 80 + 40);
    expect(r.paidCount).toBe(3);
    expect(r.paidByCategory).toEqual({ debt: 250, fixed: 80, fees: 40 });
    expect(monthPayments(undefined, { now })).toMatchObject({ dueTotal: 0, paidTotal: 0 });
  });
});
