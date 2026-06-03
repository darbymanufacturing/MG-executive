/**
 * Contract tests for pmeAnalyses.js — bug #367, bug #506.
 * Guards the PME KPI exports against silent regressions.
 * All time-sensitive tests use data far in the future so Date.now()-based filters stay stable.
 */
import { describe, it, expect } from 'vitest';
import {
  countRealTrips,
  overturnToRepairCorrelation,
  trueOverturnsReport,
  downtimeByCause,
  overturnBaseline,
} from '../pmeAnalyses.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function ev(scooterId, beforeState, afterState, timestamp) {
  return { scooterId, beforeState, afterState, timestamp, eventType: 'other' };
}

// ─── countRealTrips ───────────────────────────────────────────────────────────

describe('countRealTrips', () => {
  it('returns 0 for empty events', () => {
    expect(countRealTrips([])).toBe(0);
  });

  it('counts a clean trip_start → trip_end pair', () => {
    const events = [
      ev('SC1', 'available', 'on trip',   '2025-06-01T10:00:00Z'),
      ev('SC1', 'on trip',   'available', '2025-06-01T10:15:00Z'),
    ];
    expect(countRealTrips(events)).toBe(1);
  });

  it('ignores trips shorter than minSecs', () => {
    const events = [
      ev('SC1', 'available', 'on trip',   '2025-06-01T10:00:00Z'),
      ev('SC1', 'on trip',   'available', '2025-06-01T10:00:05Z'), // 5s < 30s default
    ];
    expect(countRealTrips(events, 30)).toBe(0);
  });

  it('counts multiple trips per scooter', () => {
    const events = [
      ev('SC1', 'available', 'on trip',   '2025-06-01T10:00:00Z'),
      ev('SC1', 'on trip',   'available', '2025-06-01T10:15:00Z'),
      ev('SC1', 'available', 'trip',      '2025-06-01T11:00:00Z'),
      ev('SC1', 'trip',      'available', '2025-06-01T11:30:00Z'),
    ];
    expect(countRealTrips(events)).toBe(2);
  });

  it('counts trips across multiple scooters independently', () => {
    const events = [
      ev('SC1', 'available', 'on trip',   '2025-06-01T10:00:00Z'),
      ev('SC1', 'on trip',   'available', '2025-06-01T10:15:00Z'),
      ev('SC2', 'available', 'on trip',   '2025-06-01T10:00:00Z'),
      ev('SC2', 'on trip',   'available', '2025-06-01T10:20:00Z'),
    ];
    expect(countRealTrips(events)).toBe(2);
  });

  it('handles paused state in the middle of a trip as continuation', () => {
    const events = [
      ev('SC1', 'available', 'on trip',    '2025-06-01T10:00:00Z'),
      ev('SC1', 'on trip',   'trip paused','2025-06-01T10:10:00Z'),
      ev('SC1', 'trip paused','on trip',   '2025-06-01T10:12:00Z'),
      ev('SC1', 'on trip',   'available',  '2025-06-01T10:30:00Z'),
    ];
    // One trip that includes a pause
    expect(countRealTrips(events)).toBe(1);
  });

  // bug #506 — null-guard regression test
  it('does not throw when an event is missing a timestamp (bug #506)', () => {
    const events = [
      ev('SC1', 'available', 'on trip',   '2025-06-01T10:00:00Z'),
      // event without a timestamp — previously crashed with TypeError
      { scooterId: 'SC1', beforeState: 'on trip', afterState: 'available', timestamp: null, eventType: 'other' },
      ev('SC1', 'on trip',   'available', '2025-06-01T10:15:00Z'),
    ];
    expect(() => countRealTrips(events)).not.toThrow();
    // The null-timestamp event is silently filtered; the valid pair still counts
    expect(countRealTrips(events)).toBe(1);
  });
});

// ─── overturnToRepairCorrelation ─────────────────────────────────────────────

describe('overturnToRepairCorrelation', () => {
  it('returns pearsonR=0 and empty perScooter for no events or tickets', () => {
    const { pearsonR, perScooter } = overturnToRepairCorrelation([], []);
    expect(pearsonR).toBe(0);
    expect(perScooter).toEqual([]);
  });

  it('returns pearsonR in [-1, 1]', () => {
    const events = [
      { scooterId: 'SC1', eventType: 'overturned', beforeState: 'on trip', afterState: 'overturned', timestamp: '2025-01-01T00:00:00Z', reason: '' },
      { scooterId: 'SC2', eventType: 'overturned', beforeState: 'on trip', afterState: 'overturned', timestamp: '2025-01-02T00:00:00Z', reason: '' },
    ];
    const tickets = [
      { scooterId: 'SC1', status: 'Completed', category: 'Mechanical', dateEntered: '2025-01-02' },
    ];
    const { pearsonR } = overturnToRepairCorrelation(events, tickets);
    expect(pearsonR).toBeGreaterThanOrEqual(-1);
    expect(pearsonR).toBeLessThanOrEqual(1);
  });

  it('returns per-scooter counts', () => {
    const events = [
      { scooterId: 'SC1', eventType: 'overturned', beforeState: 'on trip', afterState: 'overturned', timestamp: '2025-01-01T00:00:00Z', reason: '' },
    ];
    const tickets = [
      { scooterId: 'SC1', status: 'Completed', category: 'Mechanical', dateEntered: '2025-01-02' },
      { scooterId: 'SC1', status: 'Completed', category: 'Mechanical', dateEntered: '2025-01-05' },
    ];
    const { perScooter } = overturnToRepairCorrelation(events, tickets);
    const sc1 = perScooter.find((s) => s.scooterId === 'SC1');
    expect(sc1).toBeDefined();
    expect(sc1.overturns).toBe(1);
    expect(sc1.repairs).toBe(2);
  });
});

// ─── trueOverturnsReport ──────────────────────────────────────────────────────

describe('trueOverturnsReport', () => {
  it('returns empty array for no events', () => {
    expect(trueOverturnsReport([])).toEqual([]);
  });

  it('groups overturns by scooterId', () => {
    const events = [
      { scooterId: 'SC1', eventType: 'overturned', beforeState: 'on trip', afterState: 'overturned', timestamp: '2099-01-01T00:00:00Z', reason: '' },
      { scooterId: 'SC1', eventType: 'overturned', beforeState: 'on trip', afterState: 'overturned', timestamp: '2099-01-02T00:00:00Z', reason: '' },
      { scooterId: 'SC2', eventType: 'overturned', beforeState: 'on trip', afterState: 'overturned', timestamp: '2099-01-01T00:00:00Z', reason: '' },
    ];
    const report = trueOverturnsReport(events);
    expect(report).toHaveLength(2);
    const sc1 = report.find((r) => r.scooterId === 'SC1');
    expect(sc1.total).toBe(2);
  });

  it('sorts by total descending', () => {
    const events = [
      { scooterId: 'SC2', eventType: 'overturned', beforeState: 'on trip', afterState: 'overturned', timestamp: '2099-01-01T00:00:00Z', reason: '' },
      { scooterId: 'SC1', eventType: 'overturned', beforeState: 'on trip', afterState: 'overturned', timestamp: '2099-01-01T00:00:00Z', reason: '' },
      { scooterId: 'SC1', eventType: 'overturned', beforeState: 'on trip', afterState: 'overturned', timestamp: '2099-01-02T00:00:00Z', reason: '' },
    ];
    const report = trueOverturnsReport(events);
    expect(report[0].scooterId).toBe('SC1');
  });

  it('filters overturns that occurred during rebalance (beforeState = Rebalancing)', () => {
    const events = [
      // True overturn: on trip → overturned
      { scooterId: 'SC1', eventType: 'overturned', beforeState: 'on trip',    afterState: 'overturned', timestamp: '2099-01-01T00:00:00Z', reason: '' },
      // NOT a true overturn: beforeState is a rebalance state → excluded by isTrueOverturn
      { scooterId: 'SC2', eventType: 'overturned', beforeState: 'Rebalancing', afterState: 'overturned', timestamp: '2099-01-01T00:00:00Z', reason: '' },
    ];
    const report = trueOverturnsReport(events);
    expect(report.find((r) => r.scooterId === 'SC1')).toBeDefined();
    expect(report.find((r) => r.scooterId === 'SC2')).toBeUndefined();
  });
});

// ─── downtimeByCause ─────────────────────────────────────────────────────────

describe('downtimeByCause', () => {
  it('returns all zeros for empty events', () => {
    const { byCause, totalHours } = downtimeByCause([]);
    expect(totalHours).toBe(0);
    expect(byCause.rebalance).toBe(0);
    expect(byCause.maintenance).toBe(0);
  });

  it('accumulates maintenance downtime hours', () => {
    const events = [
      { scooterId: 'SC1', eventType: 'maintenance_start', timestamp: '2025-06-01T08:00:00Z' },
      { scooterId: 'SC1', eventType: 'trip_start',        timestamp: '2025-06-01T10:00:00Z' },
    ];
    const { byCause } = downtimeByCause(events);
    expect(byCause.maintenance).toBeCloseTo(2, 1); // ~2 hours
  });

  it('returns byScooter map with total per scooter', () => {
    const events = [
      { scooterId: 'SC1', eventType: 'maintenance_start', timestamp: '2025-06-01T08:00:00Z' },
      { scooterId: 'SC1', eventType: 'trip_start',        timestamp: '2025-06-01T10:00:00Z' },
    ];
    const { byScooter } = downtimeByCause(events);
    expect(byScooter['SC1']).toBeCloseTo(2, 1);
  });

  it('ignores intervals longer than 30 days', () => {
    const events = [
      { scooterId: 'SC1', eventType: 'rebalance_start', timestamp: '2025-01-01T00:00:00Z' },
      { scooterId: 'SC1', eventType: 'trip_start',      timestamp: '2025-03-01T00:00:00Z' }, // >30 days
    ];
    const { byCause } = downtimeByCause(events);
    expect(byCause.rebalance).toBe(0);
  });
});

// ─── overturnBaseline null-timestamp guard (bug #506) ────────────────────────

describe('overturnBaseline', () => {
  it('returns zero baseline for a scooter with no events', () => {
    const result = overturnBaseline([], 'SC1');
    expect(result.lifetimeMean).toBe(0);
    expect(result.anomaly).toBe(false);
  });

  // bug #506 — null-guard regression test
  it('does not throw when an overturn event is missing a timestamp (bug #506)', () => {
    const events = [
      { scooterId: 'SC1', eventType: 'overturned', beforeState: 'on trip', afterState: 'overturned', timestamp: '2025-01-01T00:00:00Z', reason: '' },
      // event without a timestamp — previously crashed with TypeError in sort comparator
      { scooterId: 'SC1', eventType: 'overturned', beforeState: 'on trip', afterState: 'overturned', timestamp: null, reason: '' },
    ];
    expect(() => overturnBaseline(events, 'SC1')).not.toThrow();
    const result = overturnBaseline(events, 'SC1');
    // Only the valid-timestamp event is counted (null-ts event filtered out)
    expect(result.totalCount).toBe(1);
  });
});
