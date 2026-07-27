import { describe, it, expect } from 'vitest';
import {
  PLANNER_METRICS,
  PLANNER_METRIC_LABELS,
  plannerYears,
  buildPlannerModel,
} from '../financialPlanner.js';

const NOW = new Date(2026, 5, 26); // 2026-06-26

describe('constants', () => {
  it('PLANNER_METRICS is the exact 7 metrics in order', () => {
    expect(PLANNER_METRICS).toEqual([
      'revenue', 'expenses', 'netCashFlow', 'dividends', 'retained', 'opening', 'closing',
    ]);
  });

  it('PLANNER_METRIC_LABELS has the exact Excel labels', () => {
    expect(PLANNER_METRIC_LABELS).toEqual({
      revenue: 'REVENUE',
      expenses: 'EXPENSES',
      netCashFlow: 'NET CASH FLOW',
      dividends: 'DIVIDENDS RELEASED',
      retained: 'RETAINED EARNINGS',
      opening: 'OPENING BALANCE',
      closing: 'CLOSING BALANCE',
    });
  });
});

describe('plannerYears', () => {
  it('collects distinct years from cost startDate + revenue date, ascending', () => {
    const costs = [
      { id: 'a', startDate: '2025-03-01' },
      { id: 'b', startDate: '2026-01-01' },
    ];
    const revenue = [{ date: '2024-12-31', location: 'Athens', totalPaidRevenue: 10 }];
    expect(plannerYears(costs, revenue)).toEqual([2024, 2025, 2026]);
  });

  it('falls back to [currentYear] when both inputs are empty or dateless', () => {
    expect(plannerYears([], [], NOW)).toEqual([2026]);
    expect(plannerYears([{ id: 'x' }], [{ location: 'Athens' }], NOW)).toEqual([2026]);
  });
});

describe('buildPlannerModel — category bucketing', () => {
  const costs = [
    { id: 'sw', name: 'Starlink', category: 'SW subscriptions, Telco charges', amount: 40, frequency: 'monthly', startDate: '2026-01-01' },
    { id: 'st', name: 'Mechanic', category: 'Employees', amount: 1000, frequency: 'monthly', startDate: '2026-01-01' },
    { id: 'ceo', name: 'Owner draw', category: 'CEO', amount: 800, frequency: 'monthly', startDate: '2026-01-01' },
    { id: 'xfer', name: 'Internal move', category: 'Transfer, withdraw', amount: 300, frequency: 'monthly', startDate: '2026-01-01' },
    { id: 'oth', name: 'Rent', category: 'Space rent', amount: 500, frequency: 'monthly', startDate: '2026-01-01' },
  ];
  const revenue = [
    { date: '2026-01-05', location: 'Athens', totalPaidRevenue: 1000 },
    { date: '2026-01-10', location: 'Thessaloniki', totalPaidRevenue: 500 },
    { date: '2026-01-20', location: 'Athens', totalPaidRevenue: 200 },
  ];

  const model = buildPlannerModel({ costs, revenue, year: 2026, openingBalance: 0, now: NOW });
  const jan = model.months[0];

  it('CEO → dividends (not an expense); Transfer → excluded entirely', () => {
    expect(jan.dividendItems).toEqual([{ id: 'ceo', label: 'Owner draw', amount: 800 }]);
    expect(jan.summary.dividends).toBe(800);
    // Transfer must not appear anywhere: not in any expense group, not in totals.
    const allExpenseLabels = [...jan.expenseGroups.software, ...jan.expenseGroups.staff, ...jan.expenseGroups.others]
      .map((i) => i.label);
    expect(allExpenseLabels).not.toContain('Internal move');
  });

  it('routes software / staff / others buckets correctly', () => {
    expect(jan.expenseGroups.software).toEqual([{ id: 'sw', label: 'Starlink', amount: 40 }]);
    expect(jan.expenseGroups.staff).toEqual([{ id: 'st', label: 'Mechanic', amount: 1000 }]);
    expect(jan.expenseGroups.others).toEqual([{ id: 'oth', label: 'Rent', amount: 500 }]);
    expect(jan.totals).toEqual({ revenue: 1700, software: 40, staff: 1000, others: 500, expenses: 1540 });
  });

  it('revenueItems aggregate by city (location) and sort descending', () => {
    expect(jan.revenueItems).toEqual([
      { label: 'Athens', amount: 1200 },
      { label: 'Thessaloniki', amount: 500 },
    ]);
  });

  it('monthly summary formulas: netCashFlow / retained / opening / closing', () => {
    expect(jan.summary.revenue).toBe(1700);
    expect(jan.summary.expenses).toBe(1540);
    expect(jan.summary.netCashFlow).toBe(160); // 1700 - 1540
    expect(jan.summary.retained).toBe(-640);   // 160 - 800
    expect(jan.summary.opening).toBe(0);
    expect(jan.summary.closing).toBe(-640);    // 0 + -640
  });

  it('hasData is true when the month has any revenue/expense/dividend activity, false otherwise', () => {
    expect(jan.hasData).toBe(true); // has revenue + expenses + dividends
    const empty = buildPlannerModel({ costs: [], revenue: [], year: 2026, openingBalance: 0, now: NOW });
    expect(empty.months[0].hasData).toBe(false);
  });
});

describe('buildPlannerModel — recurring expansion (monthly/quarterly + endDate cutoff)', () => {
  const costs = [
    { id: 'rent', name: 'Rent', category: 'Space rent', amount: 500, frequency: 'monthly', startDate: '2026-01-01' },
    { id: 'ins', name: 'Insurance', category: 'Insurance', amount: 300, frequency: 'quarterly', startDate: '2026-01-01' },
    { id: 'sub', name: 'Short sub', category: 'Consumables', amount: 50, frequency: 'monthly', startDate: '2026-01-01', endDate: '2026-03-15' },
  ];
  const model = buildPlannerModel({ costs, revenue: [], year: 2026, openingBalance: 0, now: NOW });

  it('monthly recurs every month with no end', () => {
    model.months.forEach((m) => {
      expect(m.expenseGroups.others.some((i) => i.label === 'Rent')).toBe(true);
    });
  });

  it('quarterly steps by 3 months from the start (Jan, Apr, Jul, Oct)', () => {
    const monthsWithIns = model.months
      .map((m, i) => ({ i, has: m.expenseGroups.others.some((x) => x.label === 'Insurance') }))
      .filter((x) => x.has)
      .map((x) => x.i);
    expect(monthsWithIns).toEqual([0, 3, 6, 9]);
  });

  it('endDate cuts a monthly cost off after its end month (Mar included, Apr excluded)', () => {
    expect(model.months[2].expenseGroups.others.some((i) => i.label === 'Short sub')).toBe(true);  // March
    expect(model.months[3].expenseGroups.others.some((i) => i.label === 'Short sub')).toBe(false); // April
  });
});

describe('buildPlannerModel — one-time cost', () => {
  it('counts only in its startDate month', () => {
    const costs = [{ id: 'capex', name: 'New scooter', category: 'Machines and Vehicles', amount: 2000, frequency: 'one-time', startDate: '2026-03-10' }];
    const model = buildPlannerModel({ costs, revenue: [], year: 2026, openingBalance: 0, now: NOW });
    expect(model.months[2].expenseGroups.others).toEqual([{ id: 'capex', label: 'New scooter', amount: 2000 }]);
    expect(model.months[1].expenseGroups.others).toEqual([]);
    expect(model.months[3].expenseGroups.others).toEqual([]);
  });
});

describe('buildPlannerModel — weekly/daily estimates', () => {
  const costs = [
    { id: 'fuel', name: 'Fuel', category: 'Fuel', amount: 100, frequency: 'weekly', startDate: '2026-01-01' },
    { id: 'parts', name: 'Parts', category: 'Parts', amount: 5, frequency: 'daily', startDate: '2026-01-01' },
  ];
  const model = buildPlannerModel({ costs, revenue: [], year: 2026, openingBalance: 0, now: NOW });

  it('weekly is estimated as amount × 52/12 per active month, flagged isEstimate', () => {
    const jan = model.months[0].expenseGroups.others.find((i) => i.label === 'Fuel');
    expect(jan.isEstimate).toBe(true);
    expect(jan.amount).toBe(433.33); // 100 * 52/12 = 433.333...
  });

  it('daily is estimated as amount × daysInMonth, differing between Jan (31) and Feb (28, non-leap 2026)', () => {
    const jan = model.months[0].expenseGroups.others.find((i) => i.label === 'Parts');
    const feb = model.months[1].expenseGroups.others.find((i) => i.label === 'Parts');
    expect(jan.isEstimate).toBe(true);
    expect(jan.amount).toBe(155); // 5 * 31
    expect(feb.amount).toBe(140); // 5 * 28
  });
});

describe('buildPlannerModel — multi-item aggregation (expenses not merged)', () => {
  it('keeps two same-name/category cost rows as separate line items', () => {
    const costs = [
      { id: 'a', name: 'Contractor', category: 'Contractors', amount: 300, frequency: 'monthly', startDate: '2026-01-01' },
      { id: 'b', name: 'Contractor', category: 'Contractors', amount: 250, frequency: 'monthly', startDate: '2026-01-01' },
    ];
    const model = buildPlannerModel({ costs, revenue: [], year: 2026, openingBalance: 0, now: NOW });
    expect(model.months[0].expenseGroups.staff).toHaveLength(2);
    expect(model.months[0].totals.staff).toBe(550);
  });
});

describe('buildPlannerModel — opening balance chaining + yearly totals', () => {
  const costs = [{ id: 'c', name: 'Fixed cost', category: 'Space rent', amount: 400, frequency: 'monthly', startDate: '2026-01-01' }];
  const revenue = Array.from({ length: 12 }, (_, i) => ({
    date: `2026-${String(i + 1).padStart(2, '0')}-15`,
    location: 'Athens',
    totalPaidRevenue: 1000,
  }));
  const model = buildPlannerModel({ costs, revenue, year: 2026, openingBalance: 500, now: NOW });

  it('January opens on the year opening-balance input', () => {
    expect(model.months[0].summary.opening).toBe(500);
    expect(model.months[0].summary.closing).toBe(1100); // 500 + (1000-400)
  });

  it('each subsequent month opens on the previous month\'s closing', () => {
    for (let i = 1; i < 12; i += 1) {
      expect(model.months[i].summary.opening).toBe(model.months[i - 1].summary.closing);
    }
    expect(model.months[11].summary.closing).toBe(500 + 12 * 600); // 7700
  });

  it('yearly panel sums the 12 months and derives closing as opening + retained (not summing closings)', () => {
    expect(model.yearly.revenue).toBe(12000);
    expect(model.yearly.expenses).toBe(4800);
    expect(model.yearly.dividends).toBe(0);
    expect(model.yearly.netCashFlow).toBe(7200);
    expect(model.yearly.retained).toBe(7200);
    expect(model.yearly.opening).toBe(500);
    expect(model.yearly.closing).toBe(7700); // opening + retained, NOT sum(monthly closings)
  });
});

describe('buildPlannerModel — trend indicators', () => {
  it('January is always null; increase/stable/decrease/zero-blank are computed correctly', () => {
    // revenue: Jan 1000, Feb 1000 (stable), Mar 1500 (increase), Apr 0 (blank),
    // May 1500 (increase off a zero base), Jun 1000 (decrease), Jul-Dec 1000 (stable)
    const monthlyRevenue = [1000, 1000, 1500, 0, 1500, 1000, 1000, 1000, 1000, 1000, 1000, 1000];
    const revenue = monthlyRevenue.flatMap((amt, i) => (amt === 0 ? [] : [{
      date: `2026-${String(i + 1).padStart(2, '0')}-10`,
      location: 'Athens',
      totalPaidRevenue: amt,
    }]));
    const model = buildPlannerModel({ costs: [], revenue, year: 2026, openingBalance: 0, now: NOW });

    expect(model.trends.revenue[0]).toBeNull(); // January
    expect(model.trends.revenue[1]).toBe(2);    // Feb: 1000 === 1000 → stable
    expect(model.trends.revenue[2]).toBe(1);    // Mar: 1500 > 1000 → increase
    expect(model.trends.revenue[3]).toBe(0);    // Apr: current === 0 → blank
    expect(model.trends.revenue[4]).toBe(1);    // May: 1500 > 0 → increase
    expect(model.trends.revenue[5]).toBe(-1);   // Jun: 1000 < 1500 → decrease
    expect(model.trends.revenue[6]).toBe(2);    // Jul: 1000 === 1000 → stable
  });

  it('computes trends for all 7 metrics with 12 entries each', () => {
    const model = buildPlannerModel({ costs: [], revenue: [], year: 2026, openingBalance: 0, now: NOW });
    PLANNER_METRICS.forEach((metric) => {
      expect(model.trends[metric]).toHaveLength(12);
      expect(model.trends[metric][0]).toBeNull();
    });
  });
});

describe('buildPlannerModel — skips invalid rows', () => {
  it('skips a cost with a missing/invalid startDate and a revenue row with a missing date', () => {
    const costs = [
      { id: 'bad', name: 'No date', category: 'Space rent', amount: 999, frequency: 'monthly' },
      { id: 'bad2', name: 'Bad date', category: 'Space rent', amount: 999, frequency: 'monthly', startDate: 'not-a-date' },
      { id: 'good', name: 'Good', category: 'Space rent', amount: 100, frequency: 'monthly', startDate: '2026-01-01' },
    ];
    const revenue = [
      { location: 'Athens', totalPaidRevenue: 500 }, // missing date
      { date: '2026-01-05', location: 'Athens', totalPaidRevenue: 200 },
    ];
    const model = buildPlannerModel({ costs, revenue, year: 2026, openingBalance: 0, now: NOW });
    expect(model.months[0].expenseGroups.others).toEqual([{ id: 'good', label: 'Good', amount: 100 }]);
    expect(model.months[0].revenueItems).toEqual([{ label: 'Athens', amount: 200 }]);
  });
});

describe('buildPlannerModel — empty inputs', () => {
  it('returns 12 zeroed, hasData:false months and a zeroed yearly panel', () => {
    const model = buildPlannerModel({ costs: [], revenue: [], year: 2026, openingBalance: 250, now: NOW });
    expect(model.months).toHaveLength(12);
    model.months.forEach((m, i) => {
      expect(m.hasData).toBe(false);
      expect(m.summary.revenue).toBe(0);
      expect(m.summary.expenses).toBe(0);
      expect(m.summary.dividends).toBe(0);
      expect(m.summary.opening).toBe(250);
      expect(m.summary.closing).toBe(250);
      expect(m.name).toBe(['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'][i]);
    });
    expect(model.yearly).toEqual({
      revenue: 0, expenses: 0, dividends: 0, opening: 250, netCashFlow: 0, retained: 0, closing: 250,
    });
  });

  it('defaults year to the current year when omitted', () => {
    const model = buildPlannerModel({ costs: [], revenue: [], openingBalance: 0, now: NOW });
    expect(model.year).toBe(2026);
  });
});
