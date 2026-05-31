/**
 * backfillPlan.js — the COLLECTION-TREATMENT CONTRACT for the B6 orgId backfill.
 *
 * Extracted from backfill-org-id.mjs so the single riskiest judgment in an
 * irreversible migration — "which collection gets MIGRATE vs STAMP vs left-alone" —
 * is unit-tested + CI-protected, not buried as untested inline data.
 *
 * The danger this guards against: a DETERMINISTIC-id collection mistakenly treated as
 * STAMP keeps its un-prefixed id, so the day a 2nd org exists it collides (one org's
 * scooter "70055" overwrites the other's). classifyCollection() + the tests make that
 * misclassification fail loudly here instead of silently in prod.
 *
 * Pure data + a pure function — no firebase-admin import, so it loads in plain Vitest
 * (no emulator). The .mjs script imports these same sets, so the test IS the script's
 * contract.
 */

// Deterministic-id collections → COPY each doc to `${orgId}_${oldId}` + DELETE old.
// (ids built from business values — scooter codes, dates, SKUs — that collide across orgs.)
export const MIGRATE = Object.freeze([
  'scooters', 'maintenanceTickets', 'maintenanceParts', 'revenue',
  'scooterTrips', 'telemetryEvents', 'sprEvents', 'sprWeather',
]);

// Auto/unique-id collections → add `orgId` field, KEEP the doc id.
// (Firestore auto-ids, uuids, or per-user keys like briefs `${date}_${uid}` — globally unique.)
export const STAMP = Object.freeze([
  'costs', 'projects', 'decisionGates', 'brainstormIdeas', 'diary', 'issues',
  'repairProcedures', 'repairSessions', 'notifications', 'syncLogs', 'briefs', 'pow_tasks',
]);

// Singleton config docs → copy to org-composite id + delete old.
export const CONFIG_SINGLETONS = Object.freeze([
  ['config', 'fleet'], ['config', 'scooters'], ['config', 'maintenance'], ['config', 'spr'],
  ['pow', 'config'],
]);

// Handled specially (users/org) or deliberately left alone (config/pow parents, hopp progress).
export const SPECIAL = Object.freeze(['users', 'organizations', 'config', 'pow', 'backfill_state']);

/**
 * Classify a live collection name into its backfill treatment.
 * Returns 'migrate' | 'stamp' | 'special' | 'unknown'.
 * 'unknown' = a collection the plan has never reasoned about → the script must LOG +
 * SKIP it (never silently touch un-reasoned data in an irreversible run).
 */
export function classifyCollection(name) {
  if (MIGRATE.includes(name)) return 'migrate';
  if (STAMP.includes(name)) return 'stamp';
  if (SPECIAL.includes(name)) return 'special';
  return 'unknown';
}

/**
 * The treatment to ACTUALLY apply this run, given the run flags. Same return values
 * as classifyCollection, except:
 *   - stampOnly=true downgrades 'migrate' → 'stamp' (write only the orgId FIELD, keep
 *     the doc id). Used to defer the expensive id-prefix migration: the new app finds
 *     docs by the orgId field-filter, so a field-stamp is enough for it to work; the
 *     id-prefix can run later as a no-downtime background pass. This is how
 *     telemetryEvents (10k+ docs, id-migrate = 2 writes/doc > Spark's 20k/day cap) is
 *     made cheap (1 write/doc) + safe to run as a single throttled command.
 * 'special'/'unknown' are unaffected (never migrated/stamped as data here).
 */
export function effectiveTreatment(name, { stampOnly = false } = {}) {
  const base = classifyCollection(name);
  if (stampOnly && base === 'migrate') return 'stamp';
  return base;
}
