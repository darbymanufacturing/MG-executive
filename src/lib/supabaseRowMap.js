/**
 * supabaseRowMap — the single source of truth for mapping a Firestore document of
 * one of the five time-series collections into a Supabase row (ADR-0013).
 *
 * Pure (no Firebase, no Supabase, no import.meta) so BOTH the browser dual-write
 * (src/lib/supabase.js → dualWriteSupabase) AND the Node backfill script
 * (scripts/backfill-firestore-to-supabase.mjs) import it — one mapping, no drift.
 *
 * Row shape: { org_id, source_doc_id, <typed/indexed columns>, data }
 *   • source_doc_id = the Firestore document id (the idempotency key; ON CONFLICT)
 *   • data          = the COMPLETE original doc (camelCase) so the client reads an
 *                     identical shape; typed columns are an SQL-queryable subset.
 */

const num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  // Normalize European decimal separator (e.g. "3,67" → "3.67").
  // Only replace a comma that acts as a decimal separator:
  // a trailing pattern like "1,234" (thousands sep) should not be changed —
  // but for our domain (battery %, km, revenue) values never use thousands commas.
  const normalized = typeof v === 'string' ? v.replace(',', '.') : v;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    // eslint-disable-next-line no-console
    console.warn('[supabaseRowMap] num(): could not parse value to a finite number — dropping to null. Raw value:', v);
    return null;
  }
  return parsed;
};
const bool = (v) => (typeof v === 'boolean' ? v : null);

/** Firestore collection name → Supabase table name. */
export const SUPABASE_TABLE = Object.freeze({
  telemetryEvents: 'telemetry_events',
  scooterTrips: 'scooter_trips',
  sprEvents: 'spr_events',
  sprWeather: 'spr_weather',
  revenue: 'revenue_days',
});

/** Per-collection extractor of the typed/indexed columns (camelCase doc → snake_case cols). */
const TYPED_COLUMNS = Object.freeze({
  telemetryEvents: (d) => ({
    scooter_id: d.scooterId ?? null,
    event_ts: d.timestamp ?? null,
    before_state: d.beforeState ?? null,
    after_state: d.afterState ?? null,
    reason: d.reason ?? null,
    event_type: d.eventType ?? null,
    city: d.city ?? null,
    battery_level: num(d.batteryLevel),
  }),
  scooterTrips: (d) => ({
    scooter_id: d.scooterId ?? null,
    started_at: d.startedAt ?? null,
    ended_at: d.endedAt ?? null,
    duration_minutes: num(d.durationMinutes),
    distance_km: num(d.distanceKm),
    cost: num(d.cost),
    is_paid: bool(d.isPaid),
    city: d.city ?? null,
  }),
  sprEvents: (d) => ({
    scooter_id: d.scooterId ?? null,
    datetime: d.datetime ?? null,
    city: d.city ?? null,
    zone: d.zone ?? null,
    lat: num(d.lat),
    lon: num(d.lon),
    after_state: d.afterState ?? null,
    action: d.action ?? null,
  }),
  sprWeather: (d) => ({
    weather_date: d.date ?? null,
    city: d.city ?? null,
  }),
  revenue: (d) => ({
    revenue_date: d.date ?? null,
    location: d.location ?? null,
    total_paid_revenue: num(d.totalPaidRevenue),
    total_trips: num(d.totalTrips),
    unique_users_count: num(d.uniqueUsersCount),
    unique_vehicles_count: num(d.uniqueVehiclesCount),
  }),
});

/** Drop undefined + Firestore sentinels (e.g. serverTimestamp) so `data` is valid jsonb. */
export function jsonbSafe(value) {
  if (value === null || value === undefined) return null;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  // Firestore FieldValue sentinels (serverTimestamp etc.) — not serializable; drop.
  if (value && typeof value === 'object' && value._methodName) return null;
  if (Array.isArray(value)) return value.map(jsonbSafe);
  if (typeof value === 'object') {
    const out = {};
    // Use Object.keys (not Object.entries) so keys whose value is `undefined`
    // are visited — jsonbSafe(undefined) returns null, preserving the key.
    // Object.entries silently skips own properties with undefined values, which
    // would silently drop them instead of converting them to null (BUG #466).
    for (const k of Object.keys(value)) {
      out[k] = jsonbSafe(value[k]); // always null (never undefined), no guard needed
    }
    return out;
  }
  return value;
}

/**
 * Map one Firestore doc to its Supabase row.
 * @param {string} collectionName one of the keys of SUPABASE_TABLE
 * @param {string} orgId          tenant id (also the RLS key)
 * @param {string} sourceDocId    the Firestore document id (incl. org prefix)
 * @param {object} data           the document data (camelCase)
 */
export function toSupabaseRow(collectionName, orgId, sourceDocId, data) {
  const typed = TYPED_COLUMNS[collectionName];
  if (!typed) throw new Error(`toSupabaseRow: no mapping for collection "${collectionName}"`);
  const clean = jsonbSafe(data) ?? {};
  return {
    org_id: orgId,
    source_doc_id: sourceDocId,
    ...typed(clean),
    data: clean,
  };
}
