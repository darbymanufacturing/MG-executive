/**
 * Regression test for bug #414: jsonbSafe (from supabaseRowMap.js) must drop
 * Firestore FieldValue sentinels (_methodName) from the data jsonb column.
 *
 * These four cases cover exactly the regression: the old local clean() in
 * backfill-firestore-to-supabase.mjs had no _methodName guard, so sentinels
 * leaked into Postgres. jsonbSafe is the fix.
 */
import { describe, it, expect } from 'vitest';
import { jsonbSafe } from '../../src/lib/supabaseRowMap.js';

describe('jsonbSafe — bug #414 regression', () => {
  it('(1) top-level object with _methodName returns null', () => {
    const sentinel = { _methodName: 'serverTimestamp' };
    expect(jsonbSafe(sentinel)).toBeNull();
  });

  it('(2) nested object containing a sentinel field returns outer object with that field null', () => {
    const input = {
      name: 'Athens',
      createdAt: { _methodName: 'serverTimestamp' },
    };
    const result = jsonbSafe(input);
    expect(result.name).toBe('Athens');
    expect(result.createdAt).toBeNull();
  });

  it('(3) Timestamp-like object (.toDate()) returns an ISO string', () => {
    const fakeTs = { toDate: () => new Date('2025-01-15T10:30:00.000Z') };
    const result = jsonbSafe(fakeTs);
    expect(typeof result).toBe('string');
    expect(result).toBe('2025-01-15T10:30:00.000Z');
  });

  it('(4) plain primitives pass through unchanged', () => {
    expect(jsonbSafe(0)).toBe(0);
    expect(jsonbSafe('')).toBe('');
    expect(jsonbSafe('hello')).toBe('hello');
    expect(jsonbSafe(false)).toBe(false);
    expect(jsonbSafe(null)).toBeNull();
  });
});
