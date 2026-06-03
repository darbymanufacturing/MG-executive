/**
 * Contract tests for jsonbSafe (supabaseRowMap.js).
 *
 * The FieldValue sentinel tests are a regression canary: if a Firebase SDK
 * upgrade renames _methodName and _delegate._methodName, the three
 * 'drops …' tests will fail at CI time before the corruption ever reaches
 * the Postgres jsonb column.
 */
import { describe, it, expect } from 'vitest';
import { serverTimestamp, increment, arrayUnion, Timestamp } from 'firebase/firestore';
import { jsonbSafe } from '../supabaseRowMap.js';

describe('jsonbSafe — FieldValue sentinel filtering', () => {
  it('drops serverTimestamp()', () => expect(jsonbSafe(serverTimestamp())).toBeNull());
  it('drops increment(1)', () => expect(jsonbSafe(increment(1))).toBeNull());
  it('drops arrayUnion("x")', () => expect(jsonbSafe(arrayUnion('x'))).toBeNull());

  it('converts Timestamp to ISO string', () => {
    const ts = Timestamp.fromDate(new Date('2024-01-01T00:00:00Z'));
    expect(jsonbSafe(ts)).toBe('2024-01-01T00:00:00.000Z');
  });

  it('passes through plain objects, arrays, primitives', () => {
    expect(jsonbSafe({ a: 1, b: null })).toEqual({ a: 1, b: null });
    expect(jsonbSafe([1, undefined, 2])).toEqual([1, null, 2]);
    expect(jsonbSafe('hello')).toBe('hello');
    expect(jsonbSafe(null)).toBeNull();
  });

  it('drops delegate-wrapped sentinels (_delegate._methodName)', () => {
    // Simulates a possible future Firebase internal wrapping where _methodName
    // is nested under _delegate (the secondary guard in the hardened check).
    const delegateWrapped = { _delegate: { _methodName: 'serverTimestamp' } };
    expect(jsonbSafe(delegateWrapped)).toBeNull();
  });

  it('does NOT drop a plain object that lacks both sentinel markers', () => {
    // Sanity check: arbitrary objects must not be dropped by the sentinel guard.
    expect(jsonbSafe({ foo: 'bar' })).toEqual({ foo: 'bar' });
  });
});
