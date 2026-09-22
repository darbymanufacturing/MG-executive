/**
 * Autopilot Phase 4 — planning & reporting rules.
 *   seasonalityFromRevenue  — € per scooter per day, from real revenue
 *   projectSpend            — a project's real spend from tagged costs
 *   monthExpenses / packCsv — the accountant's monthly file
 *   powWeekSummary          — the Monday recap
 *   mapDailyWeather         — one definition of a "rainy day"
 */
import { describe, it, expect } from 'vitest';
import { seasonalityFromRevenue } from '../seasonality.js';
import { projectSpend } from '../budgetFromCity.js';
import { monthExpenses, packTotals, packCsv, previousMonth } from '../accountantPack.js';
import { powWeekSummary, powSummaryText } from '../powSummary.js';
import { mapDailyWeather } from '../openMeteo.js';

describe('seasonalityFromRevenue', () => {
  const now = new Date('2026-09-22T10:00:00Z');

  it('divides month revenue by days × fleet', () => {
    const revenue = [
      { date: '2026-08-01', totalPaidRevenue: 3100 },
      { date: '2026-08-15', totalPaidRevenue: 3100 },
    ];
    const { index, basis } = seasonalityFromRevenue(revenue, { fleetSize: 40, now });
    expect(index.aug).toBe(5);          // 6200 / (31 × 40)
    expect(basis.aug).toBe('2026-08');
  });

  it('ignores the current, incomplete month and leaves empty months null', () => {
    const revenue = [{ date: '2026-09-10', totalPaidRevenue: 9999 }];
    const { index } = seasonalityFromRevenue(revenue, { fleetSize: 40, now });
    expect(index.sep).toBeNull();
    expect(index.jan).toBeNull();
  });

  it('uses the most recent occurrence of a month', () => {
    const revenue = [
      { date: '2025-10-05', totalPaidRevenue: 1240 },   // Oct 2025 — within the last 12
      { date: '2024-10-05', totalPaidRevenue: 99999 },  // older, must be ignored
    ];
    const { index, basis } = seasonalityFromRevenue(revenue, { fleetSize: 40, now });
    expect(basis.oct).toBe('2025-10');
    expect(index.oct).toBe(1); // 1240 / (31 × 40)
  });

  it('returns nothing without a fleet size', () => {
    expect(seasonalityFromRevenue([{ date: '2026-08-01', totalPaidRevenue: 100 }], { fleetSize: 0, now }).index.aug).toBeNull();
  });
});

describe('projectSpend — real spend from tagged costs', () => {
  const now = new Date('2026-09-22T10:00:00Z');
  const costs = [
    { name: 'Signs', projectId: 'p1', amount: 200, frequency: 'one-time', startDate: '2026-06-10' },
    { name: 'Storage', projectId: 'p1', amount: 50, frequency: 'monthly', startDate: '2026-07-05' },
    { name: 'Future', projectId: 'p1', amount: 999, frequency: 'one-time', startDate: '2027-01-01' },
    { name: 'Other project', projectId: 'p2', amount: 500, frequency: 'one-time', startDate: '2026-06-01' },
  ];

  it('sums one-off costs and every recurring occurrence to date', () => {
    const r = projectSpend(costs, 'p1', now);
    // 200 + 50 × (Jul, Aug, Sep) — future-dated cost not spent yet
    expect(r.spent).toBe(350);
    expect(r.count).toBe(3);
  });

  it('never mixes in another project', () => {
    expect(projectSpend(costs, 'p2', now).spent).toBe(500);
    expect(projectSpend(costs, null, now).spent).toBe(0);
  });

  it('stops a recurring cost at its end date', () => {
    const r = projectSpend([{ projectId: 'p1', amount: 10, frequency: 'monthly', startDate: '2026-01-15', endDate: '2026-03-31' }], 'p1', now);
    expect(r.spent).toBe(30); // Jan, Feb, Mar
  });
});

describe('accountant pack', () => {
  const costs = [
    { name: 'JYSK', amount: 124, vatIncluded: true, vatAmount: 24, frequency: 'one-time', startDate: '2026-08-12', category: 'Furniture', receiptUrl: 'https://res.cloudinary.com/x/y.pdf' },
    { name: 'Starlink', amount: 40, frequency: 'monthly', startDate: '2026-01-15', category: 'SW subscriptions, Telco charges', settlements: { '2026-08': { status: 'paid', at: '2026-08-15T09:00:00Z' } } },
    { name: 'Rent', amount: 350, frequency: 'monthly', startDate: '2026-01-01', category: 'Space rent', settlements: { '2026-08': { status: 'committed' } } },
    { name: 'Other month', amount: 10, frequency: 'one-time', startDate: '2026-07-30' },
  ];

  it("includes the month's one-off costs and recurring bills ticked PAID", () => {
    const rows = monthExpenses(costs, '2026-08');
    expect(rows.map((r) => r.supplier)).toEqual(['JYSK', 'Starlink']);
    expect(rows[1].date).toBe('2026-08-15');
  });

  it('keeps the VAT split and the receipt link', () => {
    const [jysk] = monthExpenses(costs, '2026-08');
    expect(jysk.vat).toBe(24);
    expect(jysk.net).toBe(100);
    expect(jysk.receiptUrl).toContain('cloudinary');
  });

  it('totals the pack', () => {
    const t = packTotals(monthExpenses(costs, '2026-08'));
    expect(t).toEqual({ count: 2, total: 164, vat: 24, withReceipt: 1 });
  });

  it('writes Greek-Excel CSV: BOM, semicolons, comma decimals, quoted fields', () => {
    const csv = packCsv([{ date: '2026-08-12', supplier: 'A; B "C"', category: 'X', amount: 124, vat: 24, net: 100, frequency: 'one-time', source: 'manual', receiptUrl: '', notes: '' }]);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
    expect(csv).toContain('124,00;24,00;100,00');
    expect(csv).toContain('"A; B ""C"""');
  });

  it('knows last month', () => {
    expect(previousMonth(new Date('2026-01-03T00:00:00Z'))).toBe('2025-12');
  });
});

describe('powWeekSummary', () => {
  const tasks = [
    { id: '1', title: 'Fix signs', status: 'done', doneWeek: 46, assignees: ['Kostas'] },
    { id: '2', title: 'Call municipality', status: 'pow', powWeeks: { Panos: 46 }, assignees: ['Panos'] },
    { id: '3', title: 'New idea', status: 'backlog', createdWeek: 46, assignees: [] },
    { id: '4', title: 'Old', status: 'done', doneWeek: 40, assignees: ['Kostas'] },
  ];

  it('splits last week into done / carried / added', () => {
    const s = powWeekSummary(tasks, 46);
    expect(s.done.map((t) => t.id)).toEqual(['1']);
    expect(s.carried.map((t) => t.id)).toEqual(['2']);
    expect(s.added.map((t) => t.id)).toEqual(['3']);
    expect(s.byPerson).toEqual({ Kostas: { done: 1, carried: 0 }, Panos: { done: 0, carried: 1 } });
  });

  it('drafts shareable text', () => {
    const text = powSummaryText(powWeekSummary(tasks, 46));
    expect(text).toContain('week 46 recap');
    expect(text).toContain('Fix signs (Kostas)');
    expect(text).toContain('Carried into this week (1)');
  });
});

describe('mapDailyWeather', () => {
  it('flags rain by amount or by weather code', () => {
    const days = mapDailyWeather({
      time: ['2026-09-20', '2026-09-21', '2026-09-22'],
      precipitation_sum: [0, 2.4, 0.2],
      weather_code: [0, 3, 80],
      temperature_2m_mean: [24.26, 21, null],
    });
    expect(days.map((d) => d.isRainy)).toEqual([false, true, true]);
    expect(days[0].temperature).toBe(24.3);
    expect(days[2].temperature).toBeNull();
  });

  it('returns [] for an empty response', () => {
    expect(mapDailyWeather(null)).toEqual([]);
  });
});
