#!/usr/bin/env node
/**
 * backfill-hopp-history.mjs — one-time historical backfill of ALL Hopp data into Firestore.
 *
 * Pulls, PER SCOOTER, PER MONTH (small windows dodge Hopp's wide-range timeouts):
 *   - list_trips         → scooterTrips        (+ feeds the revenue rollup, --rollup-revenue)
 *   - list_repair_events → maintenanceTickets
 *   - list_status_events → telemetryEvents     (ALL events; city injected at write time)
 *
 * Per-fleet start dates (launch): Corinth 2025-03-05, Nafplion 2025-08-01.
 *
 * Designed for Firebase **Spark** (20K writes/day) + the **shared Hopp token** (#316):
 *   - RESUMABLE: progress is saved to Firestore `backfill_state/hopp` after every scooter-month,
 *     so an interrupted run (quota hit, token rotated by browser use) resumes where it left off.
 *   - THROTTLED: stops cleanly at --max-writes (default 15000) per run; re-run next day to continue.
 *   - IDEMPOTENT: every write keys on the Hopp `_docId`, so re-runs overwrite, never duplicate.
 *   - DRY-RUN by default: prints what it WOULD pull/write per scooter-month. Add --commit to write.
 *
 * Auth: uses the deployed omni-data-bridge MCP (its own Hopp token). If the token dies mid-run
 * (Kostas browsed Hopp → rotated it, #316), MCP calls start erroring — the script logs the errors
 * and keeps its progress; re-seed a fresh token (see runbook) and re-run to continue.
 *
 * Firestore creds: GOOGLE_APPLICATION_CREDENTIALS=<path to service-account.json>
 *                  (or FIREBASE_SERVICE_ACCOUNT_KEY=<json string>).
 * MCP:             HOPP_MCP_URL (default https://hopp-mcp.vercel.app/api/mcp)
 *                  MCP_BEARER_TOKEN (required).
 *
 * Usage:
 *   node scripts/backfill-hopp-history.mjs                 # dry run (no writes) — preview
 *   node scripts/backfill-hopp-history.mjs --commit        # the real backfill (resumable)
 *   node scripts/backfill-hopp-history.mjs --only 54889    # one scooter (debug)
 *   node scripts/backfill-hopp-history.mjs --commit --max-writes 18000
 *   node scripts/backfill-hopp-history.mjs --rollup-revenue --commit   # phase 2: trips → daily revenue
 *   node scripts/backfill-hopp-history.mjs --reset         # clear saved progress + start over
 */

import admin from 'firebase-admin';
import { rollupTripsToRevenue } from '../src/utils/hoppSyncRollup.js';

// ── Config ────────────────────────────────────────────────────────────────
const MCP_URL   = process.env.HOPP_MCP_URL || 'https://hopp-mcp.vercel.app/api/mcp';
const MCP_TOKEN = process.env.MCP_BEARER_TOKEN;
const FLEET_START = { Corinth: '2025-03-05', Nafplion: '2025-08-01' };
const DEFAULT_START = '2025-03-05';            // fallback for unknown city
const PROGRESS_DOC = 'backfill_state/hopp';
const COMPLETED_SUBCOLL = 'completed';
const BATCH_SIZE = 450;
const ROLLUP_PAGE = 5000;
const COLLECTIONS = {
  scooters: 'scooters',
  trips: 'scooterTrips',
  tickets: 'maintenanceTickets',
  events: 'telemetryEvents',
  revenue: 'revenue',
};

// ── Args ──────────────────────────────────────────────────────────────────
/**
 * Parse the backfill CLI arguments from an argv slice (default: process.argv.slice(2)).
 * Exported so tests can call it directly with synthetic argv arrays.
 */
export function parseArgs(argv = process.argv.slice(2)) {
  const COMMIT      = argv.includes('--commit');
  const RESET       = argv.includes('--reset');
  const ROLLUP_ONLY = argv.includes('--rollup-revenue');

  const onlyIdx = argv.indexOf('--only');
  const onlyVal = onlyIdx >= 0 ? argv[onlyIdx + 1] : undefined;
  const ONLY = (onlyVal && !onlyVal.startsWith('--')) ? onlyVal : null;

  const mwIdx = argv.indexOf('--max-writes');
  let MAX_WRITES = 15000;
  if (mwIdx >= 0) {
    const n = parseInt(argv[mwIdx + 1], 10);
    if (!Number.isFinite(n) || n <= 0) {
      console.warn(`[warn] --max-writes value "${argv[mwIdx + 1]}" is invalid; defaulting to 15000`);
    } else {
      MAX_WRITES = n;
    }
  }

  return { COMMIT, RESET, ROLLUP_ONLY, ONLY, MAX_WRITES };
}

const args = process.argv.slice(2);
const { COMMIT, RESET, ROLLUP_ONLY, ONLY, MAX_WRITES } = parseArgs(args);

let writesThisRun = 0;

// ── Firebase admin ──────────────────────────────────────────────────────────
function initAdmin() {
  if (admin.apps.length) return admin.firestore();
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (raw) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  } else {
    console.error('ERROR: set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_KEY.');
    process.exit(1);
  }
  return admin.firestore();
}

// ── MCP call (JSON-RPC over Streamable HTTP / SSE) ──────────────────────────
let _rid = 0;
async function callMcp(tool, toolArgs) {
  if (!MCP_TOKEN) throw new Error('MCP_BEARER_TOKEN not set');
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MCP_TOKEN}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++_rid, method: 'tools/call', params: { name: tool, arguments: toolArgs } }),
  });
  if (!res.ok) throw new Error(`MCP HTTP ${res.status} for ${tool}`);
  const text = await res.text();
  const ct = res.headers.get('content-type') || '';
  let rpc;
  if (ct.includes('text/event-stream')) {
    const line = text.split(/\r?\n/).find((l) => l.startsWith('data:'));
    if (!line) throw new Error(`MCP empty SSE for ${tool}`);
    rpc = JSON.parse(line.slice(5).trim());
  } else {
    rpc = JSON.parse(text);
  }
  if (rpc.error) throw new Error(`MCP ${tool} rpc error: ${rpc.error.message}`);
  const payloadText = rpc.result?.content?.[0]?.text;
  if (rpc.result?.isError) throw new Error(`MCP ${tool} tool error: ${String(payloadText).slice(0, 200)}`);
  return JSON.parse(payloadText);
}

// ── Helpers ─────────────────────────────────────────────────────────────────
// Inclusive list of "YYYY-MM" month keys from start month to current month (UTC).
function monthsFrom(startIso) {
  const out = [];
  const start = new Date(startIso + 'T00:00:00Z');
  const now = new Date();
  let y = start.getUTCFullYear(), m = start.getUTCMonth();
  const endY = now.getUTCFullYear(), endM = now.getUTCMonth();
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m + 1).padStart(2, '0')}`);
    m++; if (m > 11) { m = 0; y++; }
  }
  return out;
}
function monthWindow(ym, launchIso) {
  const [y, m] = ym.split('-').map(Number);
  let since = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  const launch = new Date(launchIso + 'T00:00:00Z');
  if (launch > since) since = launch;                 // don't pull before the fleet launched
  const until = new Date(Date.UTC(y, m, 1, 0, 0, 0)); // first day of next month
  const now = new Date();
  return { since: since.toISOString(), until: (until > now ? now : until).toISOString() };
}

async function writeDocs(db, collection, items, { merge, stamp, injectCity }) {
  if (!items?.length) return 0;
  let n = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const item of chunk) {
      const { _docId, ...data } = item;
      if (!_docId) continue;
      if (injectCity && !data.city) data.city = injectCity;
      data[stamp] = admin.firestore.FieldValue.serverTimestamp();
      const ref = db.collection(collection).doc(String(_docId));
      merge ? batch.set(ref, data, { merge: true }) : batch.set(ref, data);
      n++;
    }
    if (COMMIT) await batch.commit();
  }
  if (COMMIT) writesThisRun += n;
  return n;
}

// ── Phase 2: revenue rollup from backfilled scooterTrips ────────────────────
async function rollupRevenue(db, scooterCityMap) {
  console.log('\n=== Phase 2: revenue rollup from scooterTrips ===');
  const accum = new Map();   // docId → { docId, data }
  let cursor = null;
  let totalTrips = 0;
  let pageCount = 0;

  while (true) {
    let q = db.collection(COLLECTIONS.trips).orderBy('startedAt').limit(ROLLUP_PAGE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    pageCount++;

    const trips = snap.docs.map((d) => ({ _docId: d.id, ...d.data() }));
    totalTrips += trips.length;
    console.log(`  Page ${pageCount}: read ${trips.length} trips (${totalTrips} total so far)…`);

    if (trips.length > 0) {
      const { rows, errors } = rollupTripsToRevenue(trips, scooterCityMap, '2025-01-01T00:00:00Z', new Date().toISOString());
      if (errors.length) console.warn(`    ${errors.length} trips skipped (unknown scooter): ${errors.slice(0, 3).join('; ')}…`);
      for (const r of rows) {
        const existing = accum.get(r.docId);
        if (!existing) {
          accum.set(r.docId, { docId: r.docId, data: { ...r.data } });
        } else {
          existing.data.totalPaidRevenue  = (existing.data.totalPaidRevenue  || 0) + (r.data.totalPaidRevenue  || 0);
          existing.data.totalTrips        = (existing.data.totalTrips        || 0) + (r.data.totalTrips        || 0);
          existing.data.totalTripDistanceKm = (existing.data.totalTripDistanceKm || 0) + (r.data.totalTripDistanceKm || 0);
          existing.data.uniqueVehiclesCount = (existing.data.uniqueVehiclesCount || 0) + (r.data.uniqueVehiclesCount || 0);
        }
      }
    }

    if (snap.size < ROLLUP_PAGE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }

  console.log(`Read ${totalTrips} trips total across ${pageCount} page(s). → ${accum.size} daily revenue rows.`);
  const n = await writeDocs(db, COLLECTIONS.revenue,
    [...accum.values()].map((r) => ({ ...r.data, _docId: r.docId })), { merge: true, stamp: 'lastSyncedAt' });
  console.log(`  ${COMMIT ? 'Wrote' : '[dry-run] would write'} ${n} revenue rows.`);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const db = initAdmin();
  console.log(`\n[backfill-hopp-history] ${COMMIT ? 'COMMIT' : 'DRY-RUN'} | maxWrites/run=${MAX_WRITES}` +
    `${ONLY ? ` | only=${ONLY}` : ''} | MCP=${MCP_URL}`);

  // Load scooters (code + city) from Firestore.
  const scootersSnap = await db.collection(COLLECTIONS.scooters).get();
  let scooters = scootersSnap.docs.map((d) => ({ code: String(d.data().scooterId || d.id), city: d.data().city || d.data().location || 'Unknown' }));
  if (ONLY) scooters = scooters.filter((s) => s.code === ONLY);
  const cityMap = new Map(scooters.map((s) => [s.code, s.city]));
  console.log(`Loaded ${scooters.length} scooters.`);

  if (ROLLUP_ONLY) { await rollupRevenue(db, cityMap); console.log('\nDone (rollup only).'); return; }

  // Progress (resume support).
  const progRef = db.doc(PROGRESS_DOC);
  if (RESET && COMMIT) {
    const completedDocs = await progRef.collection(COMPLETED_SUBCOLL).listDocuments();
    if (completedDocs.length) {
      const b = db.batch();
      completedDocs.forEach((ref) => b.delete(ref));
      await b.commit();
    }
    await progRef.delete().catch(() => {});
    console.log('Progress reset.');
  }
  const progSnap = await progRef.get();
  const completedSnap = await progRef.collection(COMPLETED_SUBCOLL).get();
  const done = new Set(completedSnap.docs.map((d) => d.id));
  const totals = (progSnap.exists && progSnap.data().totals) || { trips: 0, tickets: 0, events: 0 };
  console.log(`${done.size} scooter-months already completed.`);

  let stopped = false;
  outer:
  for (const { code, city } of scooters) {
    const launch = FLEET_START[city] || DEFAULT_START;
    for (const ym of monthsFrom(launch)) {
      const key = `${code}_${ym}`;
      if (done.has(key)) continue;
      if (writesThisRun >= MAX_WRITES) { stopped = true; break outer; }

      const { since, until } = monthWindow(ym, launch);
      try {
        const [tripsR, repairsR, eventsR] = [
          await callMcp('list_trips', { scooterId: code, since, until }),
          await callMcp('list_repair_events', { scooterId: code, since, until }),
          await callMcp('list_status_events', { scooterId: code, since, until }),
        ];
        const trips = tripsR?.rows || [];
        const tickets = repairsR?.tickets || [];
        const events = eventsR?.events || [];

        const wt = await writeDocs(db, COLLECTIONS.trips, trips, { merge: true, stamp: '_importedAt' });
        const wk = await writeDocs(db, COLLECTIONS.tickets, tickets, { merge: true, stamp: 'updatedAt' });
        const we = await writeDocs(db, COLLECTIONS.events, events, { merge: false, stamp: 'createdAt', injectCity: city });
        totals.trips += wt; totals.tickets += wk; totals.events += we;

        console.log(`  ${key} (${city}): ${COMMIT ? 'wrote' : 'would write'} trips=${trips.length} tickets=${tickets.length} events=${events.length}` +
          ` | run writes=${writesThisRun}`);

        done.add(key);
        if (COMMIT) {
          const cpBatch = db.batch();
          cpBatch.set(progRef.collection(COMPLETED_SUBCOLL).doc(key), { ts: admin.firestore.FieldValue.serverTimestamp() });
          cpBatch.set(progRef, { totals, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
          await cpBatch.commit();
        }
      } catch (err) {
        console.error(`  !! ${key}: ${err.message}`);
        // Stop cleanly (don't spin through errors) on the two expected fatal conditions — both resumable.
        if (/refresh token|NOT_AUTHORIZED|401|All \d+ refresh/i.test(err.message)) {
          console.error('  Hopp token appears dead (#316). Re-seed a fresh token and re-run — progress is saved.');
          stopped = true; break outer;
        }
        if (/RESOURCE_EXHAUSTED|Quota exceeded|quota/i.test(err.message)) {
          console.error('  Firebase Spark daily write quota hit. Re-run after the ~07:00 UTC reset — progress is saved.');
          stopped = true; break outer;
        }
      }
    }
  }

  console.log(`\n${stopped ? 'STOPPED early' : 'Phase 1 complete'} — ${done.size} scooter-months done.` +
    ` Cumulative: trips=${totals.trips} tickets=${totals.tickets} events=${totals.events}.`);
  if (stopped) console.log('Re-run the same command to continue from here.');
  else if (COMMIT) { await rollupRevenue(db, cityMap); }
  else console.log('(dry-run: skipping revenue rollup; run with --commit, or --rollup-revenue after.)');
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL', e); process.exit(1); });
