import { describe, it, expect } from 'vitest';
import { taxBreakdown, isTaxCost } from '../taxSummary.js';

const NOW = new Date('2026-06-26T12:00:00Z');

const costs = [
  { category: 'VAT', amount: 1000, startDate: '2026-03-10' },
  { category: 'VAT', amount: 500, startDate: '2025-11-10' },          // prior year
  { category: 'ΓΕΜΗ', amount: 100, startDate: '2026-01-23' },
  { category: 'Company Registration Fees', amount: 109.32, startDate: '2026-01-27' },
  { category: 'Customs', amount: 450.15, startDate: '2026-02-18' },
  { category: 'Fuel', amount: 40, startDate: '2026-03-01' },          // NOT a tax
  { category: 'Transfer, withdraw', amount: 200, startDate: '2026-03-01' }, // NOT a tax
];

describe('isTaxCost', () => {
  it('recognises tax categories and rejects others', () => {
    expect(isTaxCost({ category: 'VAT' })).toBe(true);
    expect(isTaxCost({ category: 'ΓΕΜΗ' })).toBe(true);
    expect(isTaxCost({ category: 'Customs' })).toBe(true);
    expect(isTaxCost({ category: 'Fuel' })).toBe(false);
    expect(isTaxCost({ category: 'credit-card' })).toBe(false);
    expect(isTaxCost(null)).toBe(false);
  });
});

describe('taxBreakdown', () => {
  const r = taxBreakdown(costs, { now: NOW });

  it('includes only tax categories', () => {
    expect(r.count).toBe(5); // 2 VAT + ΓΕΜΗ + Company Reg + Customs (Fuel & Transfer excluded)
    expect(r.categories.map((c) => c.key)).not.toContain('Fuel');
    expect(r.categories.map((c) => c.key)).not.toContain('Transfer, withdraw');
  });

  it('totals all-time and YTD correctly', () => {
    expect(r.totalAllTime).toBe(round(1000 + 500 + 100 + 109.32 + 450.15));
    // YTD (2026) excludes the 2025 VAT row
    expect(r.totalYTD).toBe(round(1000 + 100 + 109.32 + 450.15));
  });

  it('groups per category sorted by total desc, with ytd', () => {
    expect(r.categories[0].key).toBe('VAT');
    const vat = r.categories.find((c) => c.key === 'VAT');
    expect(vat.total).toBe(1500);
    expect(vat.ytd).toBe(1000);   // 2025 row excluded from ytd
    expect(vat.count).toBe(2);
  });

  it('builds a chronological monthly series', () => {
    const months = r.monthly.map((m) => m.month);
    expect(months).toEqual([...months].sort());
    expect(r.monthly.find((m) => m.month === '2026-03').total).toBe(1000);
  });

  it('handles empty input', () => {
    const e = taxBreakdown([], { now: NOW });
    expect(e).toMatchObject({ count: 0, totalAllTime: 0, totalYTD: 0, categories: [], monthly: [] });
  });
});

function round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
