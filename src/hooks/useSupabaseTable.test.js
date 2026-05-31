import { describe, it, expect } from 'vitest';
import { mapRow, OP_MAP } from './useSupabaseTable.js';
import { toSupabaseRow, SUPABASE_TABLE, jsonbSafe } from '../lib/supabaseRowMap.js';

describe('mapRow', () => {
  it('reconstructs the Firestore shape {_docId, ...data}', () => {
    const row = {
      id: 'uuid', org_id: 'o1', source_doc_id: 'o1_70055_x',
      scooter_id: '70055', data: { scooterId: '70055', afterState: 'Active', foo: 1 },
    };
    expect(mapRow(row)).toEqual({ _docId: 'o1_70055_x', scooterId: '70055', afterState: 'Active', foo: 1 });
  });

  it('handles null and empty data', () => {
    expect(mapRow(null)).toBeNull();
    expect(mapRow({ source_doc_id: 'x' })).toEqual({ _docId: 'x' });
  });

  it('drops the snake_case typed columns — only data + _docId surface', () => {
    const row = { source_doc_id: 'x', scooter_id: 'S', event_ts: 't', data: { scooterId: 'S' } };
    const out = mapRow(row);
    expect(out).not.toHaveProperty('scooter_id');
    expect(out).not.toHaveProperty('event_ts');
    expect(out.scooterId).toBe('S');
  });
});

describe('OP_MAP', () => {
  it('maps Firestore where-ops to supabase-js filter methods', () => {
    expect(OP_MAP['==']).toBe('eq');
    expect(OP_MAP['!=']).toBe('neq');
    expect(OP_MAP['>=']).toBe('gte');
    expect(OP_MAP['<']).toBe('lt');
    expect(OP_MAP.in).toBe('in');
  });
});

describe('toSupabaseRow', () => {
  it('maps a revenue doc to typed columns + preserves the full doc in data', () => {
    const doc = {
      date: '2026-04-08', location: 'Nafplio', totalPaidRevenue: 123.45,
      uniqueUsersCount: 10, totalTrips: 20, extra: 'keep-me',
    };
    const row = toSupabaseRow('revenue', 'org1', 'org1_2026-04-08_Nafplio', doc);
    expect(row.org_id).toBe('org1');
    expect(row.source_doc_id).toBe('org1_2026-04-08_Nafplio');
    expect(row.revenue_date).toBe('2026-04-08');
    expect(row.location).toBe('Nafplio');
    expect(row.total_paid_revenue).toBe(123.45);
    expect(row.unique_users_count).toBe(10);
    expect(row.total_trips).toBe(20);
    expect(row.data.extra).toBe('keep-me'); // nothing lost
  });

  it('maps telemetry camelCase → snake_case typed columns', () => {
    const doc = {
      scooterId: '70055', timestamp: '2026-04-18T13:06:00',
      beforeState: 'Reserved', afterState: 'Active', batteryLevel: 88,
    };
    const row = toSupabaseRow('telemetryEvents', 'o', 'o_x', doc);
    expect(row.scooter_id).toBe('70055');
    expect(row.event_ts).toBe('2026-04-18T13:06:00');
    expect(row.before_state).toBe('Reserved');
    expect(row.after_state).toBe('Active');
    expect(row.battery_level).toBe(88);
  });

  it('throws for an unknown collection', () => {
    expect(() => toSupabaseRow('nope', 'o', 'x', {})).toThrow();
  });

  it('SUPABASE_TABLE covers exactly the five time-series collections', () => {
    expect(SUPABASE_TABLE.telemetryEvents).toBe('telemetry_events');
    expect(SUPABASE_TABLE.scooterTrips).toBe('scooter_trips');
    expect(SUPABASE_TABLE.sprEvents).toBe('spr_events');
    expect(SUPABASE_TABLE.sprWeather).toBe('spr_weather');
    expect(SUPABASE_TABLE.revenue).toBe('revenue_days');
    expect(Object.keys(SUPABASE_TABLE)).toHaveLength(5);
  });
});

describe('jsonbSafe', () => {
  it('strips Firestore serverTimestamp sentinels (recursively)', () => {
    const sentinel = { _methodName: 'serverTimestamp' };
    const out = jsonbSafe({ a: 1, ts: sentinel, nested: { b: sentinel, c: 2 } });
    expect(out).toEqual({ a: 1, ts: null, nested: { b: null, c: 2 } });
  });

  it('converts Timestamp-like {toDate} values to ISO strings', () => {
    const ts = { toDate: () => new Date('2026-01-01T00:00:00Z') };
    expect(jsonbSafe({ when: ts }).when).toBe('2026-01-01T00:00:00.000Z');
  });
});
