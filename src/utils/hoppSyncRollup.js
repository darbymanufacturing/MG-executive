/**
 * Trip → Revenue daily rollup — pure, testable functions used by
 * `api/cron-hopp-sync.js` to aggregate freshly-pulled Hopp trips into
 * daily-per-city rows in the `revenue` Firestore collection.
 *
 * Doc ID format matches the existing manual CSV import (`${date}_${city}`)
 * so auto-sync overwrites any prior manual entry for the same day-city.
 * The `source: 'hopp-autosync'` field provides provenance.
 *
 * Critical rule (windowing): we only emit a `revenue` row for date `d`
 * if the sync window FULLY COVERS day `d` — otherwise a mid-day sync
 * would write a row claiming it's the day's total. Days that aren't
 * fully covered get re-emitted on the next sync that does cover them.
 *
 * See docs/SCHEMA.md `revenue` collection.
 */

/**
 * Group trips by `(date, city)` and produce upsertable revenue rows for
 * any day that is FULLY contained within the sync window.
 *
 * @param {object[]} trips         — output of `callHoppTool('list_trips', ...)`.rows
 *                                   Each trip: { scooterId, startedAt, cost, distanceKm, ... }
 * @param {Map<string,string>} scooterCityMap  — scooterId → city (built from Firestore `scooters`)
 * @param {string} sinceIso        — sync window start (ISO8601)
 * @param {string} untilIso        — sync window end (ISO8601)
 * @param {Date}   [now=new Date()] — for testability
 * @returns {{ rows: object[], errors: string[] }} rows ready for upsert and any skip errors
 */
export function rollupTripsToRevenue(trips, scooterCityMap, sinceIso, untilIso, now = new Date()) {
  if (!Array.isArray(trips) || trips.length === 0) return { rows: [], errors: [] };

  const since = new Date(sinceIso);
  const until = new Date(untilIso);
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) return { rows: [], errors: [] };

  // Group trips by (YYYY-MM-DD, city)
  // Map<string, Aggregate>
  const groups = new Map();
  // #172 — collect unknown-scooter skip errors
  const errors = [];

  for (const trip of trips) {
    if (!trip || !trip.startedAt || !trip.scooterId) continue;
    const startedAt = new Date(trip.startedAt);
    if (Number.isNaN(startedAt.getTime())) continue;

    const date = isoDate(startedAt);                 // "YYYY-MM-DD"
    // #172 — skip trips for unknown scooters instead of rolling into phantom 'Unknown' city
    const city = scooterCityMap.get(String(trip.scooterId));
    if (!city) { errors.push(`Unknown scooter: ${trip.scooterId}`); continue; }
    const key = `${date}::${city}`;

    let agg = groups.get(key);
    if (!agg) {
      agg = {
        date,
        city,
        totalPaidRevenue: 0,
        totalTrips: 0,
        totalTripDistanceKm: 0,
        scooterIds: new Set(),
      };
      groups.set(key, agg);
    }

    // trip.cost is already ex-VAT per hopp-mcp's revenue maths (see AGENT_REFERENCE.md)
    agg.totalPaidRevenue    += safeNum(trip.cost);
    agg.totalTrips          += 1;
    agg.totalTripDistanceKm += safeNum(trip.distanceKm);
    agg.scooterIds.add(String(trip.scooterId));
  }

  // Emit rows only for days fully contained in [since, until]
  const rows = [];
  for (const agg of groups.values()) {
    if (!isDayFullyCovered(agg.date, since, until, now)) continue;
    rows.push({
      docId: `${agg.date}_${agg.city}`,
      data: {
        date: agg.date,
        location: agg.city,            // legacy field name preserved for dashboard compat
        city: agg.city,
        totalPaidRevenue: round2(agg.totalPaidRevenue),
        totalTrips: agg.totalTrips,
        totalTripDistanceKm: round2(agg.totalTripDistanceKm),
        uniqueVehiclesCount: agg.scooterIds.size,
        source: 'hopp-autosync',
      },
    });
  }
  return { rows, errors };
}

/**
 * Is `date` (YYYY-MM-DD) fully covered by [since, until]?
 *
 * "Fully covered" means: since ≤ start-of-day(date) AND until ≥ end-of-day(date).
 * For TODAY (date === today in UTC), we relax the end-of-day rule and accept
 * `until >= now` — otherwise we'd never emit today's row until midnight UTC.
 * (Days emitted partially-on-today get overwritten by the next sync; the
 * doc ID is deterministic so successive writes idempotently update the same row.)
 */
export function isDayFullyCovered(dateStr, since, until, now = new Date()) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return false;
  const startOfDay = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  const endOfDay   = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));

  if (since.getTime() > startOfDay.getTime()) return false;

  // Today special case: until must extend to "now" at minimum
  // #171 — use local-time date (not UTC) so midnight-local matches the user's timezone
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  if (dateStr === todayStr) {
    return until.getTime() >= now.getTime();
  }
  return until.getTime() >= endOfDay.getTime();
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function safeNum(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
