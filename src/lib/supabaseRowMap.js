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
  // Time-series (ADR-0013)
  telemetryEvents: 'telemetry_events',
  scooterTrips: 'scooter_trips',
  sprEvents: 'spr_events',
  sprWeather: 'spr_weather',
  revenue: 'revenue_days',
  // Operational (ADR-0015) — full doc lives in `data`; typed/indexed cols are
  // re-derived from `data` by per-table DB triggers, so the extractors below
  // return {} (single source of truth = the trigger, no JS/SQL drift).
  pow_tasks: 'pow_tasks',
  maintenanceTickets: 'maintenance_tickets',
  maintenanceParts: 'maintenance_parts',
  scooters: 'scooters',
  repairSessions: 'repair_sessions',
  repairProcedures: 'repair_procedures',
  projects: 'projects',
  decisionGates: 'decision_gates',
  brainstormIdeas: 'brainstorm_ideas',
  issues: 'issues',
  notifications: 'notifications',
  costs: 'costs',
  maintenanceSchedules: 'maintenance_schedules',
  fleets: 'fleets', // FF-3 multi-fleet
  ownerLedger: 'owner_ledger', // FF-1 owner ledger
  bankRules: 'bank_rules', // FF-2 founder-editable categorization rules
  loans: 'loans', // FF-2 multi-loan module
  // The two singleton-config collections both fold into one app_config table
  // (source_doc_id keeps the existing composite ids, which are globally unique).
  config: 'app_config',
  pow: 'app_config',
  // ADR-0023 identity layer — full doc in `data`; self-read by source_doc_id / org_id.
  users: 'users',
  organizations: 'organizations',
  invites: 'invites',
});

/**
 * Per-collection camelCase→snake_case translation for server-side where/orderBy
 * fields, used by the data-layer seam (useOrgCollection's Supabase branch) to
 * map a Firestore-style query onto the typed Supabase columns. Only the fields
 * actually queried server-side need an entry (verified by grepping every
 * useOrgCollection({where,orderBy}) call); unmapped fields pass through as-is.
 */
export const SUPABASE_QUERY_MAP = Object.freeze({
  repairSessions: { completedAt: 'completed_at', scooterId: 'scooter_id' },
  issues: { createdAt: 'created_at_ts' },
  notifications: { createdAt: 'created_at_ts' },
  repairProcedures: { createdAt: 'created_at_ts' },
  // #366 — maintenance_tickets.date_entered is a generated `date` column derived from
  // data->>'dateEntered' (migration bugfix_rpc_allowlist_date_entered_search_path_execute),
  // so the capped tickets listener can orderBy it instead of keeping an arbitrary slice.
  maintenanceTickets: { dateEntered: 'date_entered' },
});

/**
 * Per-collection extractor of the typed/indexed columns (camelCase doc → snake_case cols).
 *
 * #496 — the jsonb-vs-typed contract: typed columns are an SQL-queryable SUBSET of the doc.
 * The COMPLETE original doc always lives in the `data` jsonb column (via jsonbSafe), so no
 * field is ever lost. BUT a field you intend to query/aggregate in SQL (SELECT ... WHERE col,
 * GROUP BY, ORDER BY) MUST be added here as a typed column — otherwise it lives only in
 * `data` and SQL predicates silently miss it. Data-only fields (no SQL use) need no entry.
 * The "TYPED_COLUMNS drift lock" test in useSupabaseTable.test.js asserts the exact column
 * SET per time-series collection, so adding/removing a typed column without updating that
 * test (and the matching DB migration) fails CI — turning silent drift into a loud failure.
 */
export const TYPED_COLUMNS = Object.freeze({
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
    weather_date:  d.date ?? null,
    city:          d.city ?? null,
    // Bug #388: add the four climate typed columns so analytics queries can
    // use indexed SQL columns instead of slow (data->>'field')::type JSONB casts.
    // Field names match the actual Open-Meteo pipeline (openMeteo.js:59-73):
    // temperature = mean °C, totalRainMm = precipitation sum, weatherCode = WMO code.
    is_rainy:      bool(d.isRainy),
    total_rain_mm: num(d.totalRainMm),
    weather_code:  num(d.weatherCode),
    temperature_c: num(d.temperature),
  }),
  revenue: (d) => ({
    revenue_date: d.date ?? null,
    location: d.location ?? null,
    total_paid_revenue: num(d.totalPaidRevenue),
    total_trips: num(d.totalTrips),
    unique_users_count: num(d.uniqueUsersCount),
    unique_vehicles_count: num(d.uniqueVehiclesCount),
  }),
  // Operational (ADR-0015): typed/indexed cols are re-derived from `data` by
  // per-table DB triggers (omni_sync_created_at_ts / omni_sync_repair_sessions),
  // so the row only carries { org_id, source_doc_id, data } — no typed cols here.
  pow_tasks: () => ({}),
  maintenanceTickets: () => ({}),
  maintenanceParts: () => ({}),
  scooters: () => ({}),
  repairSessions: () => ({}),
  repairProcedures: () => ({}),
  projects: () => ({}),
  decisionGates: () => ({}),
  brainstormIdeas: () => ({}),
  issues: () => ({}),
  notifications: () => ({}),
  costs: () => ({}),
  maintenanceSchedules: () => ({}),
  fleets: () => ({}),
  ownerLedger: () => ({}),
  bankRules: () => ({}),
  loans: () => ({}),
  config: () => ({}),
  pow: () => ({}),
  // ADR-0023 identity layer — no typed columns; everything lives in data.
  // Self-reads use source_doc_id; org-scoped reads use org_id (both are plain columns).
  users: () => ({}),
  organizations: () => ({}),
  invites: () => ({}),
});

/** Drop undefined + Firestore sentinels (e.g. serverTimestamp) so `data` is valid jsonb. */
export function jsonbSafe(value) {
  if (value === null || value === undefined) return null;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  // Firestore FieldValue sentinels (serverTimestamp etc.) — not serializable; drop.
  // Primary check: _methodName (Firebase v9-v12 public shape).
  // Secondary check: _delegate._methodName (modular SDK internal wrapping).
  // If Firebase renames both, the contract tests in
  // src/lib/__tests__/supabaseRowMap.test.js will fail immediately at CI time,
  // catching the regression before silent {} corruption reaches the Postgres jsonb column.
  if (
    value &&
    typeof value === 'object' &&
    (value._methodName ||
      (value._delegate && typeof value._delegate._methodName === 'string'))
  ) return null;
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
