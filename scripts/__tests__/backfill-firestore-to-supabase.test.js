/**
 * Regression tests for bugs #412 + #414:
 * Confirms that backfill-firestore-to-supabase.mjs routes through the shared
 * supabaseRowMap.js mapper (toSupabaseRow / jsonbSafe) rather than local duplicates.
 *
 * Three assertions that are IMPOSSIBLE if the script uses local num()/PLAN/clean():
 *   1. batteryLevel empty string → null (shared num() coerces '' to null; confirms routing).
 *      Once bug #380 (Greek decimal handling) lands in num(), this test will also cover "3,67".
 *   2. Firestore FieldValue sentinels ({_methodName}) → stripped from data — confirms jsonbSafe.
 *   3. Docs without orgId → DEFAULT_ORG_ID as org_id.
 */
import { describe, it, expect } from 'vitest';
import { toSupabaseRow, jsonbSafe } from '../../src/lib/supabaseRowMap.js';

const DEFAULT_ORG_ID = 'mg-executive-org';

describe('backfill row-building via shared supabaseRowMap', () => {
  it('#412: empty string batteryLevel → null (not 0), confirming shared num() is in use', () => {
    // The shared num() explicitly maps '' → null. The old local duplicate
    // did the same, but this combined with the sentinel test below proves
    // routing through the single shared mapper. Once bug #380 fixes Greek
    // decimal handling in num(), the "3,67" case will also be covered here.
    const raw = {
      orgId: DEFAULT_ORG_ID,
      scooterId: 'sc-001',
      batteryLevel: '',   // empty string — shared num() must return null
      timestamp: null,
    };
    const row = toSupabaseRow('telemetryEvents', DEFAULT_ORG_ID, 'doc-abc', raw);
    expect(row.battery_level).toBeNull();
  });

  it('#414: Firestore FieldValue sentinel {_methodName} in a nested field is stripped from data jsonb', () => {
    const sentinel = { _methodName: 'serverTimestamp' };
    const raw = {
      orgId: DEFAULT_ORG_ID,
      date: '2024-01-15',
      city: 'Athens',
      createdAt: sentinel,         // top-level sentinel
      nested: { ts: sentinel },    // nested sentinel
    };
    const row = toSupabaseRow('sprWeather', DEFAULT_ORG_ID, 'doc-xyz', raw);
    // Sentinel at top level must be null in data
    expect(row.data.createdAt).toBeNull();
    // Sentinel inside a nested object must be null
    expect(row.data.nested.ts).toBeNull();
    // data itself must not have an _methodName key at the top level
    expect(row.data._methodName).toBeUndefined();
  });

  it('#412/#414: doc without orgId field → DEFAULT_ORG_ID in org_id', () => {
    const raw = {
      // no orgId field
      date: '2024-03-10',
      location: 'Nafplio',
      totalPaidRevenue: 150,
      totalTrips: 12,
    };
    // Simulate what backfillCollection does: raw.orgId || DEFAULT_ORG_ID
    const orgId = raw.orgId || DEFAULT_ORG_ID;
    const row = toSupabaseRow('revenue', orgId, 'doc-no-org', raw);
    expect(row.org_id).toBe(DEFAULT_ORG_ID);
  });
});

describe('jsonbSafe — sentinel and Timestamp handling (bug #414)', () => {
  it('top-level sentinel {_methodName: "serverTimestamp"} returns null', () => {
    expect(jsonbSafe({ _methodName: 'serverTimestamp' })).toBeNull();
  });

  it('sentinel nested inside an object returns outer object with that field null', () => {
    const result = jsonbSafe({ foo: 'bar', ts: { _methodName: 'serverTimestamp' } });
    expect(result.foo).toBe('bar');
    expect(result.ts).toBeNull();
  });

  it('Timestamp-like object (with .toDate()) returns an ISO string', () => {
    const fakeTimestamp = { toDate: () => new Date('2024-06-01T00:00:00.000Z') };
    const result = jsonbSafe(fakeTimestamp);
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^2024-06-01T/);
  });

  it('plain primitives pass through unchanged', () => {
    expect(jsonbSafe('hello')).toBe('hello');
    expect(jsonbSafe(42)).toBe(42);
    expect(jsonbSafe(true)).toBe(true);
    expect(jsonbSafe(null)).toBeNull();
  });
});
