import { describe, test, expect } from 'vitest';
import { rollupTripsToRevenue, isDayFullyCovered } from '../hoppSyncRollup.js';

const SCOOTERS = new Map([
  ['54135', 'Nafplion'],
  ['79760', 'Nafplion'],
  ['11111', 'Corinth'],
]);

describe('rollupTripsToRevenue', () => {
  test('returns empty for no trips', () => {
    expect(rollupTripsToRevenue([], SCOOTERS, '2026-05-27T00:00:00Z', '2026-05-28T23:59:59Z')).toEqual([]);
  });

  test('aggregates single-day single-city correctly', () => {
    const trips = [
      { scooterId: '54135', startedAt: '2026-05-27T10:00:00Z', cost: 5.00, distanceKm: 2.0 },
      { scooterId: '54135', startedAt: '2026-05-27T14:00:00Z', cost: 3.50, distanceKm: 1.5 },
      { scooterId: '79760', startedAt: '2026-05-27T16:00:00Z', cost: 4.25, distanceKm: 2.5 },
    ];
    const rows = rollupTripsToRevenue(
      trips, SCOOTERS,
      '2026-05-26T00:00:00Z', '2026-05-28T00:00:00Z',
      new Date('2026-05-28T12:00:00Z'),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].docId).toBe('2026-05-27_Nafplion');
    expect(rows[0].data.totalPaidRevenue).toBeCloseTo(12.75);
    expect(rows[0].data.totalTrips).toBe(3);
    expect(rows[0].data.totalTripDistanceKm).toBeCloseTo(6.0);
    expect(rows[0].data.uniqueVehiclesCount).toBe(2);
    expect(rows[0].data.source).toBe('hopp-autosync');
    expect(rows[0].data.city).toBe('Nafplion');
    expect(rows[0].data.location).toBe('Nafplion');
  });

  test('splits multi-city same-day into separate rows', () => {
    const trips = [
      { scooterId: '54135', startedAt: '2026-05-27T10:00:00Z', cost: 5, distanceKm: 2 },
      { scooterId: '11111', startedAt: '2026-05-27T10:00:00Z', cost: 8, distanceKm: 3 },
    ];
    const rows = rollupTripsToRevenue(
      trips, SCOOTERS,
      '2026-05-26T00:00:00Z', '2026-05-28T00:00:00Z',
      new Date('2026-05-28T12:00:00Z'),
    );
    expect(rows).toHaveLength(2);
    const nafplion = rows.find((r) => r.data.city === 'Nafplion');
    const corinth  = rows.find((r) => r.data.city === 'Corinth');
    expect(nafplion.data.totalPaidRevenue).toBe(5);
    expect(corinth.data.totalPaidRevenue).toBe(8);
  });

  test('groups by date, splits across days', () => {
    const trips = [
      { scooterId: '54135', startedAt: '2026-05-26T10:00:00Z', cost: 5, distanceKm: 2 },
      { scooterId: '54135', startedAt: '2026-05-27T10:00:00Z', cost: 4, distanceKm: 1 },
    ];
    const rows = rollupTripsToRevenue(
      trips, SCOOTERS,
      '2026-05-25T00:00:00Z', '2026-05-28T00:00:00Z',
      new Date('2026-05-28T12:00:00Z'),
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.data.date === '2026-05-26').data.totalPaidRevenue).toBe(5);
    expect(rows.find((r) => r.data.date === '2026-05-27').data.totalPaidRevenue).toBe(4);
  });

  test('distinct vehicle count: 3 trips on 2 scooters → uniqueVehiclesCount=2', () => {
    const trips = [
      { scooterId: '54135', startedAt: '2026-05-27T08:00:00Z', cost: 1, distanceKm: 1 },
      { scooterId: '54135', startedAt: '2026-05-27T09:00:00Z', cost: 1, distanceKm: 1 },
      { scooterId: '79760', startedAt: '2026-05-27T10:00:00Z', cost: 1, distanceKm: 1 },
    ];
    const rows = rollupTripsToRevenue(
      trips, SCOOTERS,
      '2026-05-26T00:00:00Z', '2026-05-28T00:00:00Z',
      new Date('2026-05-28T12:00:00Z'),
    );
    expect(rows[0].data.uniqueVehiclesCount).toBe(2);
  });

  test('skips partial-day window (does not emit incomplete row)', () => {
    // Window covers ONLY 2026-05-27T12:00 → 14:00 — that day is not fully covered
    const trips = [
      { scooterId: '54135', startedAt: '2026-05-27T13:00:00Z', cost: 5, distanceKm: 2 },
    ];
    const rows = rollupTripsToRevenue(
      trips, SCOOTERS,
      '2026-05-27T12:00:00Z', '2026-05-27T14:00:00Z',
      new Date('2026-05-28T12:00:00Z'),
    );
    expect(rows).toHaveLength(0);
  });

  test('today special case: window from start-of-day-today to NOW is enough', () => {
    const now = new Date('2026-05-28T14:00:00Z');
    const trips = [
      { scooterId: '54135', startedAt: '2026-05-28T10:00:00Z', cost: 5, distanceKm: 2 },
    ];
    // since = start-of-today, until = now (12:00 UTC)
    const rows = rollupTripsToRevenue(
      trips, SCOOTERS,
      '2026-05-28T00:00:00Z', '2026-05-28T14:00:00Z',
      now,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].data.date).toBe('2026-05-28');
  });

  test('drops trips with missing scooterId or startedAt', () => {
    const trips = [
      { scooterId: '54135', startedAt: '2026-05-27T10:00:00Z', cost: 5, distanceKm: 2 },
      { startedAt: '2026-05-27T11:00:00Z', cost: 3 },                  // no scooterId
      { scooterId: '54135', cost: 2 },                                 // no startedAt
      { scooterId: '54135', startedAt: 'not-a-date', cost: 1 },        // invalid date
    ];
    const rows = rollupTripsToRevenue(
      trips, SCOOTERS,
      '2026-05-26T00:00:00Z', '2026-05-28T00:00:00Z',
      new Date('2026-05-28T12:00:00Z'),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].data.totalTrips).toBe(1);
  });

  test('treats missing scooter city as "Unknown"', () => {
    const trips = [{ scooterId: 'GHOST', startedAt: '2026-05-27T10:00:00Z', cost: 5, distanceKm: 2 }];
    const rows = rollupTripsToRevenue(
      trips, SCOOTERS,
      '2026-05-26T00:00:00Z', '2026-05-28T00:00:00Z',
      new Date('2026-05-28T12:00:00Z'),
    );
    expect(rows[0].data.city).toBe('Unknown');
    expect(rows[0].docId).toBe('2026-05-27_Unknown');
  });

  test('rounds revenue and distance to 2 decimal places', () => {
    const trips = [
      { scooterId: '54135', startedAt: '2026-05-27T10:00:00Z', cost: 1.234567, distanceKm: 0.987654 },
    ];
    const rows = rollupTripsToRevenue(
      trips, SCOOTERS,
      '2026-05-26T00:00:00Z', '2026-05-28T00:00:00Z',
      new Date('2026-05-28T12:00:00Z'),
    );
    expect(rows[0].data.totalPaidRevenue).toBe(1.23);
    expect(rows[0].data.totalTripDistanceKm).toBe(0.99);
  });

  test('treats null/missing cost as 0', () => {
    const trips = [
      { scooterId: '54135', startedAt: '2026-05-27T10:00:00Z', cost: null, distanceKm: 2 },
      { scooterId: '54135', startedAt: '2026-05-27T11:00:00Z', distanceKm: 1 },
    ];
    const rows = rollupTripsToRevenue(
      trips, SCOOTERS,
      '2026-05-26T00:00:00Z', '2026-05-28T00:00:00Z',
      new Date('2026-05-28T12:00:00Z'),
    );
    expect(rows[0].data.totalPaidRevenue).toBe(0);
    expect(rows[0].data.totalTrips).toBe(2);
  });

  test('returns empty for invalid window dates', () => {
    expect(rollupTripsToRevenue([{}], SCOOTERS, 'bad', '2026-05-28T00:00:00Z')).toEqual([]);
    expect(rollupTripsToRevenue([{}], SCOOTERS, '2026-05-28T00:00:00Z', 'bad')).toEqual([]);
  });

  test('doc ID format matches manual CSV import for collision-free overwrite', () => {
    const trips = [{ scooterId: '54135', startedAt: '2026-05-27T10:00:00Z', cost: 5, distanceKm: 2 }];
    const rows = rollupTripsToRevenue(
      trips, SCOOTERS,
      '2026-05-26T00:00:00Z', '2026-05-28T00:00:00Z',
      new Date('2026-05-28T12:00:00Z'),
    );
    // Manual CSV uses `${date}_${location || 'global'}`; auto-sync uses same → upsert wins last
    expect(rows[0].docId).toBe('2026-05-27_Nafplion');
  });
});

describe('isDayFullyCovered', () => {
  test('past day fully inside window → true', () => {
    expect(isDayFullyCovered(
      '2026-05-27',
      new Date('2026-05-26T00:00:00Z'),
      new Date('2026-05-28T23:59:59Z'),
      new Date('2026-05-28T12:00:00Z'),
    )).toBe(true);
  });

  test('past day, window ends mid-day → false', () => {
    expect(isDayFullyCovered(
      '2026-05-27',
      new Date('2026-05-26T00:00:00Z'),
      new Date('2026-05-27T12:00:00Z'),
      new Date('2026-05-28T12:00:00Z'),
    )).toBe(false);
  });

  test('today, window reaches now → true', () => {
    const now = new Date('2026-05-28T14:00:00Z');
    expect(isDayFullyCovered(
      '2026-05-28',
      new Date('2026-05-28T00:00:00Z'),
      new Date('2026-05-28T14:00:00Z'),
      now,
    )).toBe(true);
  });

  test('today, window ends before now → false', () => {
    const now = new Date('2026-05-28T14:00:00Z');
    expect(isDayFullyCovered(
      '2026-05-28',
      new Date('2026-05-28T00:00:00Z'),
      new Date('2026-05-28T10:00:00Z'),
      now,
    )).toBe(false);
  });

  test('invalid date string → false', () => {
    expect(isDayFullyCovered(
      'not-a-date',
      new Date('2026-05-26T00:00:00Z'),
      new Date('2026-05-28T23:59:59Z'),
    )).toBe(false);
  });
});
