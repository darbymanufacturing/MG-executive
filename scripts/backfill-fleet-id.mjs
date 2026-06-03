#!/usr/bin/env node
/**
 * backfill-fleet-id.mjs — ONE-TIME backfill to stamp `fleetId` on existing
 * operational docs that carry a `city` / `location` field but pre-date the
 * #556 / #559 canonical-fleetId convention (shipped 2026-06-03).
 *
 * ⚠️  RUNNING THIS AGAINST LIVE DATA IS THE REMAINING OPS STEP FOR #556.
 *     Before --commit: take a backup (scripts/backup-firestore.mjs).
 *     After running, verify a sample of docs in each collection then flip
 *     VITE_DATA_LAYER back to 'supabase' if it was temporarily set to 'firestore'.
 *
 * How it works:
 *   1. Load the `fleets` collection for the given org and build a
 *      case-insensitive city → fleetId map (first-wins, matching scopeByFleet).
 *   2. For each operational collection listed below, page through ALL docs
 *      that already have an `orgId` field matching the org.
 *   3. For any doc that LACKS a `fleetId` but has a `city` or `location` field
 *      that resolves to a fleet in step 1, STAMP `fleetId`.
 *   4. Docs with no matching city (unassigned) are left untouched — correct
 *      behaviour: scopeByFleet includes them in every fleet view.
 *   5. Docs already carrying `fleetId` are SKIPPED (idempotent).
 *
 * Collections covered:
 *   revenue        — `location` or `city`
 *   sprEvents      — `city`
 *   sprWeather     — `city`
 *   telemetryEvents — `city`
 *   scooterTrips   — `city` (hopp cron stamps it; CSV imports may lack it)
 *   scooters       — `city` (main fleet-identity field; Scooters.jsx already
 *                    stamps fleetId on new writes but legacy rows may not have it)
 *
 * SAFETY:
 *   - DRY-RUN BY DEFAULT: reads + reports counts, writes NOTHING.
 *     Add --commit to actually write.
 *   - IDEMPOTENT: a re-run skips docs that already have `fleetId`.
 *   - THROTTLED: --max-writes (default 15000) to stay under Spark/Blaze limits.
 *     Re-run if the budget is exhausted (stamping picks up where it left off).
 *   - STAGED: --only <collection[,collection]> to do one at a time.
 *   - PAGE size is 200 docs; BATCH_SIZE is 450 ops (stays under Firestore limit).
 *
 * Firestore creds (one of):
 *   FIREBASE_SERVICE_ACCOUNT_KEY='<service-account JSON string>'
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * Usage:
 *   node scripts/backfill-fleet-id.mjs                          # DRY RUN
 *   node scripts/backfill-fleet-id.mjs --commit                 # actually write
 *   node scripts/backfill-fleet-id.mjs --only revenue           # one collection
 *   node scripts/backfill-fleet-id.mjs --commit --only sprEvents,sprWeather
 *   node scripts/backfill-fleet-id.mjs --commit --max-writes 10000
 *   node scripts/backfill-fleet-id.mjs --org-id my-org-id      # non-default org
 */

import admin from 'firebase-admin';

// ── Config ────────────────────────────────────────────────────────────────────
const ORG_ID = process.env.BACKFILL_ORG_ID || 'mg-executive-org';
const PAGE       = 200;   // Firestore page size
const BATCH_SIZE = 450;   // ops per Firestore batch (limit is 500; stay safe)

// Operational collections to backfill + which field carries the city identity.
// Order doesn't matter (all are independent); listed roughly by volume ascending.
const COLLECTIONS = [
  { name: 'revenue',          cityField: (d) => d.location || d.city || null },
  { name: 'sprWeather',       cityField: (d) => d.city ?? null },
  { name: 'sprEvents',        cityField: (d) => d.city ?? null },
  { name: 'scooters',         cityField: (d) => d.city ?? null },
  { name: 'scooterTrips',     cityField: (d) => d.city ?? null },
  { name: 'telemetryEvents',  cityField: (d) => d.city ?? null },
];

// ── Args ──────────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const COMMIT  = args.includes('--commit');
const ONLY    = (() => {
  const i = args.indexOf('--only');
  return i >= 0 ? new Set(args[i + 1].split(',').map((s) => s.trim())) : null;
})();
const EXCLUDE = (() => {
  const i = args.indexOf('--exclude');
  return i >= 0 ? new Set(args[i + 1].split(',').map((s) => s.trim())) : new Set();
})();
const MAX_WRITES = (() => {
  const i = args.indexOf('--max-writes');
  return i >= 0 ? parseInt(args[i + 1], 10) : 15000;
})();
const ORG_ARG = (() => {
  const i = args.indexOf('--org-id');
  return i >= 0 ? args[i + 1] : null;
})();
const effectiveOrgId = ORG_ARG || ORG_ID;

let writes = 0;
const report = {};

function budgetLeft() { return writes < MAX_WRITES; }
function wantCollection(name) {
  return (!ONLY || ONLY.has(name)) && !EXCLUDE.has(name);
}

// ── Firebase admin ────────────────────────────────────────────────────────────
function initAdmin() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (raw) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp();
  } else {
    console.error(
      'ERROR: set FIREBASE_SERVICE_ACCOUNT_KEY (JSON string) or ' +
      'GOOGLE_APPLICATION_CREDENTIALS (file path).',
    );
    process.exit(1);
  }
}

// ── Build city → fleetId map from the `fleets` collection ────────────────────
async function buildCityToFleetMap(db) {
  const snap = await db.collection('fleets').where('orgId', '==', effectiveOrgId).get();
  // Also try: some fleets collections may use org-prefixed doc ids but orgId inside.
  // If the above returns 0 and the collection is org-prefix–keyed, do a full scan.
  let docs = snap.docs;
  if (!docs.length) {
    const all = await db.collection('fleets').get();
    docs = all.docs.filter((d) => d.data().orgId === effectiveOrgId);
  }

  const map = new Map(); // normalised-city → fleetId (first-wins)
  for (const d of docs) {
    const fleetId = d.id;
    for (const city of (d.data().cities ?? [])) {
      const key = String(city).toLowerCase().trim();
      if (!map.has(key)) {
        map.set(key, fleetId);
      } else {
        console.warn(
          `[backfill-fleet-id] City "${city}" already claimed by fleet ${map.get(key)}; ` +
          `skipping fleet ${fleetId} (first-wins, matching scopeByFleet behaviour).`,
        );
      }
    }
  }
  console.log(`  Fleet map: ${map.size} city entries from ${docs.length} fleets.`);
  if (!map.size) {
    console.warn('  ⚠️  No fleets found for org — nothing to stamp. Configure fleets first.');
  }
  return map;
}

// ── Stamp a single collection (paginated, idempotent, throttled) ──────────────
async function stampCollection(db, colName, cityField, cityToFleetId) {
  const r = report[colName] = { stamped: 0, skipped_has_fleet: 0, skipped_no_city: 0, skipped_no_fleet_match: 0, budget_stop: false };
  let last = null;

  for (;;) {
    if (!budgetLeft()) { r.budget_stop = true; break; }

    let q = db.collection(colName)
      .where('orgId', '==', effectiveOrgId)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(PAGE);
    if (last) q = q.startAfter(last);

    // eslint-disable-next-line no-await-in-loop
    const snap = await q.get();
    if (snap.empty) break;
    last = snap.docs[snap.docs.length - 1].id;

    const batch = db.batch();
    let batchOps = 0;

    for (const d of snap.docs) {
      const data = d.data();

      // Already has fleetId — idempotent skip.
      if (data.fleetId) { r.skipped_has_fleet++; continue; }

      const city = cityField(data);
      if (!city) { r.skipped_no_city++; continue; }

      const fleetId = cityToFleetId.get(String(city).toLowerCase().trim()) ?? null;
      if (!fleetId) { r.skipped_no_fleet_match++; continue; }

      if (!budgetLeft()) { r.budget_stop = true; break; }
      if (COMMIT) batch.update(d.ref, { fleetId });
      batchOps++;
      writes++;
      r.stamped++;
    }

    if (COMMIT && batchOps > 0) {
      // eslint-disable-next-line no-await-in-loop
      await batch.commit();
    }

    if (snap.size < PAGE) break;
  }

  return r;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  initAdmin();
  const db = admin.firestore();

  console.log(
    `\n${COMMIT ? '🔴 COMMIT' : '🟢 DRY RUN'} — fleetId backfill` +
    ` for org "${effectiveOrgId}"` +
    ` · max-writes: ${MAX_WRITES}` +
    `${ONLY ? ` · only: ${[...ONLY].join(',')}` : ''}` +
    `${EXCLUDE.size ? ` · exclude: ${[...EXCLUDE].join(',')}` : ''}\n`,
  );

  const cityToFleetId = await buildCityToFleetMap(db);

  if (!cityToFleetId.size) {
    console.log('No fleets configured — nothing to backfill. Exiting.');
    process.exit(0);
  }

  for (const { name, cityField } of COLLECTIONS) {
    if (!wantCollection(name)) continue;
    process.stdout.write(`  Scanning ${name.padEnd(20)}...`);
    // eslint-disable-next-line no-await-in-loop
    const r = await stampCollection(db, name, cityField, cityToFleetId);
    console.log(` stamped=${r.stamped}  already_has=${r.skipped_has_fleet}  no_city=${r.skipped_no_city}  no_match=${r.skipped_no_fleet_match}${r.budget_stop ? '  ⏸ BUDGET STOP' : ''}`);
  }

  console.log('\n── Result ' + '─'.repeat(50));
  for (const [k, v] of Object.entries(report)) {
    console.log(`  ${k.padEnd(22)} ${JSON.stringify(v)}`);
  }
  console.log('─'.repeat(62));
  console.log(
    `${COMMIT ? 'WROTE' : 'WOULD WRITE'} ~${writes} doc-updates` +
    `${writes >= MAX_WRITES ? '  ⏸  HIT max-writes — re-run to continue (resumable)' : ''}`,
  );
  if (!COMMIT) {
    console.log('DRY RUN — nothing was written. Re-run with --commit (after a backup) to apply.');
  }
  process.exit(0);
}

main().catch((e) => { console.error('\nBackfill FAILED:', e.message, e.stack); process.exit(1); });
