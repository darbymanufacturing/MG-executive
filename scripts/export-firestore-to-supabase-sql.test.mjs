/**
 * scripts/export-firestore-to-supabase-sql.test.mjs
 *
 * Unit tests for the `normalizeDates` function (BUG #416).
 * Verifies Athens-timezone off-by-one fix: UTC strings representing Athens midnight
 * must return the Athens calendar date, not the UTC date.
 *
 * Run: npx vitest run scripts/export-firestore-to-supabase-sql.test.mjs
 */
import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Stub firebase-admin and supabaseRowMap before importing the script module,
// so no Firebase connection or module resolution errors occur in test.
// ---------------------------------------------------------------------------
vi.mock('firebase-admin', () => ({
  default: { apps: [], initializeApp: vi.fn(), firestore: vi.fn() },
}));
vi.mock('../src/lib/supabaseRowMap.js', () => ({
  toSupabaseRow: vi.fn(),
  SUPABASE_TABLE: {},
}));

const { normalizeDates } = await import('./export-firestore-to-supabase-sql.mjs');

// Column definitions for date-typed and timestamptz-typed columns.
const DATE_COLS = [['revenue_date', 'date']];
const WEATHER_DATE_COLS = [['weather_date', 'date']];
const TS_COLS = [['started_at', 'timestamptz']];
const MIXED_COLS = [['revenue_date', 'date'], ['started_at', 'timestamptz']];

describe('normalizeDates — Athens timezone off-by-one fix (BUG #416)', () => {
  // -------------------------------------------------------------------------
  // Core: Athens winter midnight (UTC+2, EET) lands as prev-day in UTC.
  // "2024-12-31T22:00:00.000Z" = 2025-01-01T00:00:00+02:00 Athens time.
  // Before fix: .toISOString().slice(0,10) → "2024-12-31" (wrong).
  // After fix:  toLocaleDateString('en-CA', {timeZone:'Europe/Athens'}) → "2025-01-01" (correct).
  // -------------------------------------------------------------------------
  it('winter Athens midnight: UTC 2024-12-31T22:00:00Z → Athens date 2025-01-01', () => {
    const row = { revenue_date: '2024-12-31T22:00:00.000Z' };
    normalizeDates(row, DATE_COLS);
    expect(row.revenue_date).toBe('2025-01-01');
  });

  // -------------------------------------------------------------------------
  // Athens summer midnight (UTC+3, EEST): "2024-06-14T21:00:00.000Z" = 2024-06-15 Athens.
  // Before fix: .toISOString().slice(0,10) → "2024-06-14" (wrong).
  // After fix: → "2024-06-15" (correct).
  // -------------------------------------------------------------------------
  it('summer Athens midnight (EEST UTC+3): UTC 2024-06-14T21:00:00Z → Athens date 2024-06-15', () => {
    const row = { revenue_date: '2024-06-14T21:00:00.000Z' };
    normalizeDates(row, DATE_COLS);
    expect(row.revenue_date).toBe('2024-06-15');
  });

  // -------------------------------------------------------------------------
  // Pass-through: already a YYYY-MM-DD string. new Date("2025-01-01") parses as
  // UTC midnight (00:00Z), which is 02:00 Athens time — same calendar date.
  // Must remain "2025-01-01", not drift.
  // -------------------------------------------------------------------------
  it('pass-through: already YYYY-MM-DD string stays unchanged', () => {
    const row = { revenue_date: '2025-01-01' };
    normalizeDates(row, DATE_COLS);
    expect(row.revenue_date).toBe('2025-01-01');
  });

  // -------------------------------------------------------------------------
  // weather_date column uses the same code path.
  // -------------------------------------------------------------------------
  it('weather_date column: winter Athens midnight → correct Athens date', () => {
    const row = { weather_date: '2024-12-31T22:00:00.000Z' };
    normalizeDates(row, WEATHER_DATE_COLS);
    expect(row.weather_date).toBe('2025-01-01');
  });

  // -------------------------------------------------------------------------
  // timestamptz columns: must NOT be sliced — full ISO string expected.
  // -------------------------------------------------------------------------
  it('timestamptz column: returns full ISO string, not sliced', () => {
    const row = { started_at: '2024-12-31T22:00:00.000Z' };
    normalizeDates(row, TS_COLS);
    expect(row.started_at).toBe('2024-12-31T22:00:00.000Z');
  });

  // -------------------------------------------------------------------------
  // Null / empty values → null (no crash).
  // -------------------------------------------------------------------------
  it('null value → null', () => {
    const row = { revenue_date: null };
    normalizeDates(row, DATE_COLS);
    expect(row.revenue_date).toBeNull();
  });

  it('empty string → null', () => {
    const row = { revenue_date: '' };
    normalizeDates(row, DATE_COLS);
    expect(row.revenue_date).toBeNull();
  });

  it('unparseable string → null', () => {
    const row = { revenue_date: 'not-a-date' };
    normalizeDates(row, DATE_COLS);
    expect(row.revenue_date).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Mixed row with both date and timestamptz columns.
  // -------------------------------------------------------------------------
  it('mixed row: date col uses Athens tz, timestamptz col is unchanged ISO', () => {
    const row = {
      revenue_date: '2024-12-31T22:00:00.000Z',
      started_at: '2024-12-31T22:00:00.000Z',
    };
    normalizeDates(row, MIXED_COLS);
    expect(row.revenue_date).toBe('2025-01-01');
    expect(row.started_at).toBe('2024-12-31T22:00:00.000Z');
  });
});
