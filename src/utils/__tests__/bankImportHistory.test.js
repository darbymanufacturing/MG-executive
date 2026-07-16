import { describe, it, expect } from 'vitest';
import {
  bankImportHistory,
  daysBetween,
  dayAfter,
  freshnessLevel,
  freshnessLabel,
  BANK_CSV_SOURCE,
} from '../bankImportHistory.js';

const NOW = new Date(2026, 5, 30); // 2026-06-30 local midnight

// Two uploads: one on 2026-06-03 (older range), one on 2026-06-30 (fresh range).
const UPLOAD_A = '2026-06-03T22:48:23.491Z';
const UPLOAD_B = '2026-06-30T05:24:33.135Z';

const costs = [
  { source: BANK_CSV_SOURCE, createdAt: UPLOAD_A, startDate: '2025-02-12', amount: 100 },
  { source: BANK_CSV_SOURCE, createdAt: UPLOAD_A, startDate: '2026-05-20', amount: 50 },
  { source: BANK_CSV_SOURCE, createdAt: UPLOAD_B, startDate: '2026-06-29', amount: 40 },
  { source: BANK_CSV_SOURCE, createdAt: UPLOAD_B, startDate: '2026-06-10', amount: 10 },
  // noise that must be excluded
  { source: 'wallet-import', createdAt: UPLOAD_B, startDate: '2026-06-30', amount: 999 },
  { source: null, createdAt: UPLOAD_B, startDate: '2026-06-30', amount: 999 },
  { source: BANK_CSV_SOURCE, createdAt: UPLOAD_B, startDate: null, amount: 5 }, // no date
];

describe('date helpers', () => {
  it('daysBetween counts calendar days', () => {
    expect(daysBetween('2026-06-29', '2026-06-30')).toBe(1);
    expect(daysBetween('2026-06-30', '2026-06-30')).toBe(0);
    expect(daysBetween('2026-05-31', '2026-06-30')).toBe(30);
    expect(daysBetween(null, '2026-06-30')).toBeNull();
  });

  it('dayAfter rolls month ends', () => {
    expect(dayAfter('2026-06-29')).toBe('2026-06-30');
    expect(dayAfter('2026-06-30')).toBe('2026-07-01');
    expect(dayAfter('2026-02-28')).toBe('2026-03-01'); // 2026 is not a leap year
    expect(dayAfter(null)).toBeNull();
  });
});

describe('bankImportHistory', () => {
  const r = bankImportHistory(costs, { now: NOW });

  it('counts only bank-CSV rows with a date', () => {
    expect(r.count).toBe(4); // excludes wallet-import, null-source, and the dateless row
  });

  it('surfaces the latest transaction date + how stale it is', () => {
    expect(r.latestTxn).toBe('2026-06-29');
    expect(r.earliestTxn).toBe('2025-02-12');
    expect(r.daysSinceLatest).toBe(1);          // 29 Jun → 30 Jun
    expect(r.nextExportFrom).toBe('2026-06-30'); // the day after the latest txn
  });

  it('reconstructs uploads by exact createdAt, newest first', () => {
    expect(r.batches).toHaveLength(2);
    expect(r.batches[0]).toMatchObject({
      importedAt: UPLOAD_B, count: 2, earliest: '2026-06-10', latest: '2026-06-29', total: 50,
    });
    expect(r.batches[1]).toMatchObject({
      importedAt: UPLOAD_A, count: 2, earliest: '2025-02-12', latest: '2026-05-20', total: 150,
    });
  });

  it('handles no imports', () => {
    expect(bankImportHistory([], { now: NOW })).toMatchObject({
      count: 0, latestTxn: null, nextExportFrom: null, batches: [],
    });
    expect(bankImportHistory(null, { now: NOW }).count).toBe(0);
  });
});

describe('freshness', () => {
  it('buckets by staleness', () => {
    expect(freshnessLevel(0)).toBe('green');
    expect(freshnessLevel(7)).toBe('green');
    expect(freshnessLevel(8)).toBe('amber');
    expect(freshnessLevel(31)).toBe('red');
    expect(freshnessLevel(null)).toBe('muted');
  });

  it('labels readably', () => {
    expect(freshnessLabel(0)).toBe('Today');
    expect(freshnessLabel(1)).toBe('Yesterday');
    expect(freshnessLabel(5)).toBe('5 days ago');
    expect(freshnessLabel(60)).toBe('~2 months ago');
    expect(freshnessLabel(null)).toBe('—');
  });
});
