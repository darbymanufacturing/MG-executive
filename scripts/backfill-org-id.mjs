#!/usr/bin/env node
/**
 * backfill-org-id.mjs — ONE-TIME production cutover backfill for Phase 2 multi-tenancy (Milestone B6).
 *
 * Stamps the existing single-tenant `mg-executive` data with an `orgId` so the
 * Phase-2 org-scoped app (useOrgCollection + Firestore rules) can read it after
 * the cutover. Two treatments per collection:
 *
 *   STAMP   (auto/unique-id collections): add `orgId` field, KEEP the doc id.
 *           costs, projects, decisionGates, brainstormIdeas, diary, issues,
 *           repairProcedures, repairSessions, notifications, syncLogs, briefs, pow_tasks
 *
 *   MIGRATE (deterministic-id collections): COPY each doc to `${orgId}_${oldId}`
 *           (+ orgId field), then DELETE the old doc — so two orgs can never collide
 *           on a shared key (a date, a city, a SKU, a scooter code). The new id is
 *           built with the SAME `orgDocId()` helper the runtime uses, so a migrated
 *           doc lands at exactly the id a fresh write would produce.
 *           scooters, maintenanceTickets, maintenanceParts, revenue,
 *           scooterTrips, telemetryEvents, sprEvents, sprWeather
 *
 *   CONFIG singletons: config/{fleet,scooters,maintenance,spr} → config/${orgId}_*,
 *           pow/config → pow/${orgId}_config (copy + delete).
 *
 *   USERS:  set `orgId` field on every users/{uid} + set the custom claim
 *           {orgId, role} (Admin SDK) so the B4 rules admit them. (Users must
 *           refresh their token after — AuthContext does getIdToken(true), or just
 *           re-login.)
 *
 *   ORG:    create organizations/${orgId} {name, ownerUid, members[], plan, createdAt}.
 *
 * Any LIVE collection not in a known list is LEFT UNTOUCHED and LOGGED as
 * "UNHANDLED — review" — an irreversible migration must never silently touch data
 * it wasn't reasoned about.
 *
 * SAFETY — this is irreversible. The script is built to be run carefully:
 *   - DRY-RUN BY DEFAULT: reads + reports exact per-collection counts, writes NOTHING.
 *     Add --commit to actually write.
 *   - IDEMPOTENT / RESUMABLE: a re-run skips already-done docs (STAMP: orgId already set;
 *     MIGRATE: id already starts with `${orgId}_`). Safe to re-run after an interruption
 *     or a Spark-quota stop.
 *   - THROTTLED: stops cleanly at --max-writes (default 15000, under Spark's 20K/day).
 *     MIGRATE costs 2 writes/doc, so telemetryEvents alone can need >1 day — re-run.
 *   - STAGED: --only <collection[,collection]> to do one (or a few) at a time and verify.
 *
 * ⚠️ BEFORE --commit: take a fresh backup (scripts/backup-firestore.mjs) and get
 *    explicit sign-off. See docs/runbooks/backfill-orgid.md for the full sequence.
 *
 * Firestore creds (one of):
 *   FIREBASE_SERVICE_ACCOUNT_KEY='<service-account JSON string>'
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * Usage:
 *   node scripts/backfill-org-id.mjs                       # DRY RUN — preview counts, no writes
 *   node scripts/backfill-org-id.mjs --commit             # the real backfill (resumable)
 *   node scripts/backfill-org-id.mjs --only revenue       # one collection (staged verify)
 *   node scripts/backfill-org-id.mjs --commit --only scooters,maintenanceParts
 *   node scripts/backfill-org-id.mjs --commit --max-writes 18000
 *   node scripts/backfill-org-id.mjs --owner-uid <uid>    # who owns the org (else auto-detect admin)
 */
import admin from 'firebase-admin';
import { orgDocId } from '../src/utils/orgDocId.js';

// ── Config ──────────────────────────────────────────────────────────────────
const ORG_ID   = process.env.BACKFILL_ORG_ID   || 'mg-executive-org';
const ORG_NAME = process.env.BACKFILL_ORG_NAME || 'Micromobility Greece';
const PAGE = 200;           // docs per page; MIGRATE = 2 ops/doc → 400 ops < 450 batch limit

// Deterministic-id collections → COPY to `${orgId}_${oldId}` + DELETE old.
const MIGRATE = new Set([
  'scooters', 'maintenanceTickets', 'maintenanceParts', 'revenue',
  'scooterTrips', 'telemetryEvents', 'sprEvents', 'sprWeather',
]);
// Auto/unique-id collections → add `orgId` field, keep id.
const STAMP = new Set([
  'costs', 'projects', 'decisionGates', 'brainstormIdeas', 'diary', 'issues',
  'repairProcedures', 'repairSessions', 'notifications', 'syncLogs', 'briefs', 'pow_tasks',
]);
// Singleton config docs → copy to org-composite id + delete old.
const CONFIG_SINGLETONS = [
  ['config', 'fleet'], ['config', 'scooters'], ['config', 'maintenance'], ['config', 'spr'],
  ['pow', 'config'],
];
// Handled specially or deliberately left alone.
const SPECIAL = new Set(['users', 'organizations', 'config', 'pow', 'backfill_state']);

// ── Args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const COMMIT     = args.includes('--commit');
const ONLY       = (() => { const i = args.indexOf('--only'); return i >= 0 ? new Set(args[i + 1].split(',')) : null; })();
const MAX_WRITES = (() => { const i = args.indexOf('--max-writes'); return i >= 0 ? parseInt(args[i + 1], 10) : 15000; })();
const OWNER_UID  = (() => { const i = args.indexOf('--owner-uid'); return i >= 0 ? args[i + 1] : null; })();

let writes = 0;                 // writes performed (or, in dry-run, that WOULD be performed)
const report = {};              // per-collection { migrated|stamped, skipped, would }

function wantCollection(name) { return !ONLY || ONLY.has(name); }
function budgetLeft() { return writes < MAX_WRITES; }

// ── Firebase admin ──────────────────────────────────────────────────────────
function initAdmin() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (raw) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp();
  } else {
    console.error('ERROR: set FIREBASE_SERVICE_ACCOUNT_KEY (JSON string) or GOOGLE_APPLICATION_CREDENTIALS (file path).');
    process.exit(1);
  }
}

// ── STAMP: add orgId field, keep id (paginated, idempotent, throttled) ────────
async function stampCollection(db, name) {
  const r = report[name] = { mode: 'stamp', stamped: 0, skipped: 0 };
  let last = null;
  for (;;) {
    if (!budgetLeft()) { r.stoppedForBudget = true; break; }
    let q = db.collection(name).orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    last = snap.docs[snap.docs.length - 1].id;

    const batch = db.batch();
    let inBatch = 0;
    for (const d of snap.docs) {
      if (d.data().orgId === ORG_ID) { r.skipped++; continue; }
      if (!budgetLeft()) { r.stoppedForBudget = true; break; }
      if (COMMIT) batch.update(d.ref, { orgId: ORG_ID });
      inBatch++; writes++; r.stamped++;
    }
    if (COMMIT && inBatch > 0) await batch.commit();
    if (snap.size < PAGE) break;
  }
  return r;
}

// ── MIGRATE: copy to `${orgId}_${oldId}` + delete old (paginated/idempotent/throttled) ──
async function migrateCollection(db, name) {
  const r = report[name] = { mode: 'migrate', migrated: 0, skipped: 0 };
  const prefix = `${ORG_ID}_`;
  let last = null;
  for (;;) {
    if (!budgetLeft()) { r.stoppedForBudget = true; break; }
    let q = db.collection(name).orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    last = snap.docs[snap.docs.length - 1].id;

    const batch = db.batch();
    let ops = 0;
    for (const d of snap.docs) {
      if (d.id.startsWith(prefix)) { r.skipped++; continue; } // already migrated
      if (writes + 2 > MAX_WRITES) { r.stoppedForBudget = true; break; }
      const newId = orgDocId(ORG_ID, d.id);
      if (COMMIT) {
        batch.set(db.collection(name).doc(newId), { ...d.data(), orgId: ORG_ID });
        batch.delete(d.ref);
      }
      ops += 2; writes += 2; r.migrated++;
    }
    if (COMMIT && ops > 0) await batch.commit();
    if (snap.size < PAGE) break;
  }
  return r;
}

// ── CONFIG singletons: copy to org-composite id + delete old ──────────────────
async function migrateConfigSingletons(db) {
  const r = report['(config singletons)'] = { mode: 'migrate-singletons', migrated: 0, skipped: 0, missing: 0 };
  for (const [coll, id] of CONFIG_SINGLETONS) {
    if (ONLY && !ONLY.has(coll)) continue;
    const newId = `${ORG_ID}_${id}`;
    const newRef = db.collection(coll).doc(newId);
    const oldRef = db.collection(coll).doc(id);
    const [newSnap, oldSnap] = await Promise.all([newRef.get(), oldRef.get()]);
    if (newSnap.exists || !oldSnap.exists) { if (!oldSnap.exists) r.missing++; else r.skipped++; continue; }
    if (!budgetLeft()) { r.stoppedForBudget = true; break; }
    if (COMMIT) {
      await newRef.set({ ...oldSnap.data(), orgId: ORG_ID });
      await oldRef.delete();
    }
    writes += 2; r.migrated++;
  }
  return r;
}

// ── USERS: orgId field + custom claim; returns the member uid list + owner ─────
async function backfillUsers(db, auth) {
  const r = report['users'] = { mode: 'users', stamped: 0, claimsSet: 0, skipped: 0 };
  const snap = await db.collection('users').get();
  const members = [];
  let owner = OWNER_UID;
  const admins = [];
  for (const d of snap.docs) {
    members.push(d.id);
    const data = d.data();
    const role = data.role || 'staff';
    if (role === 'owner' || role === 'admin') admins.push(d.id);
    // orgId field
    if (data.orgId !== ORG_ID) {
      if (budgetLeft()) { if (COMMIT) await d.ref.update({ orgId: ORG_ID }); writes++; r.stamped++; }
    } else r.skipped++;
    // custom claim (not a Firestore write; doesn't count against the doc-write budget)
    if (COMMIT) { await auth.setCustomUserClaims(d.id, { orgId: ORG_ID, role }); r.claimsSet++; }
  }
  if (!owner) owner = admins[0] || members[0] || null;
  r.owner = owner; r.memberCount = members.length;
  return { members, owner };
}

// ── ORG doc ───────────────────────────────────────────────────────────────────
async function createOrgDoc(db, members, owner) {
  const r = report['organizations'] = { mode: 'org' };
  const ref = db.collection('organizations').doc(ORG_ID);
  const existing = await ref.get();
  if (existing.exists) { r.note = 'already exists — left as-is'; return r; }
  if (COMMIT) {
    await ref.set({
      name: ORG_NAME, ownerUid: owner, members, plan: 'active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  writes++; r.created = true; r.owner = owner; r.memberCount = members.length;
  return r;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  initAdmin();
  const db = admin.firestore();
  const auth = admin.auth();

  console.log(`\n${COMMIT ? '🔴 COMMIT' : '🟢 DRY RUN'} — orgId backfill for org "${ORG_ID}" (${ORG_NAME})`);
  console.log(`   max-writes/run: ${MAX_WRITES}${ONLY ? ` · only: ${[...ONLY].join(',')}` : ''}\n`);

  // Discover live collections; warn about anything we don't have a plan for.
  const live = (await db.listCollections()).map((c) => c.id);
  const planned = new Set([...MIGRATE, ...STAMP, ...SPECIAL]);
  const unhandled = live.filter((c) => !planned.has(c));
  if (unhandled.length) {
    console.log(`⚠️  UNHANDLED collections (left untouched — review before cutover): ${unhandled.join(', ')}\n`);
  }

  // 1. Users + claims, 2. org doc (skip if --only a data collection).
  if (!ONLY || ONLY.has('users') || ONLY.has('organizations')) {
    const { members, owner } = await backfillUsers(db, auth);
    if (!owner) console.log('⚠️  no owner could be determined (no users?) — pass --owner-uid');
    await createOrgDoc(db, members, owner);
  }

  // 3. config singletons
  await migrateConfigSingletons(db);

  // 4. data collections
  for (const name of live) {
    if (!wantCollection(name)) continue;
    if (MIGRATE.has(name)) await migrateCollection(db, name);
    else if (STAMP.has(name)) await stampCollection(db, name);
  }

  // Report
  console.log('── Result ' + '─'.repeat(50));
  for (const [k, v] of Object.entries(report)) {
    console.log(`  ${k.padEnd(22)} ${JSON.stringify(v)}`);
  }
  console.log('─'.repeat(60));
  console.log(`${COMMIT ? 'WROTE' : 'WOULD WRITE'} ~${writes} doc-writes` +
    `${writes >= MAX_WRITES ? '  ⏸  HIT max-writes — re-run to continue (resumable)' : ''}`);
  if (!COMMIT) console.log('DRY RUN — nothing was written. Re-run with --commit (after a backup) to apply.');
  process.exit(0);
}

main().catch((e) => { console.error('\nBackfill FAILED:', e.message); process.exit(1); });
