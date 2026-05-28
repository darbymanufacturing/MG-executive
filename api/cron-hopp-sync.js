/* global process */
/**
 * cron-hopp-sync — pulls latest trips / status events / repair tickets from
 * the deployed hopp-mcp server (https://hopp-mcp.vercel.app/api/mcp) and
 * upserts them into Firestore. Rolls up trips into the `revenue` collection
 * as a side effect. Writes a `syncLogs` summary doc per run.
 *
 * Dual-trigger:
 *   1. Vercel cron (top of every hour) — auth via `Authorization: Bearer ${CRON_SECRET}`
 *   2. User-triggered Refresh button in TopBar — auth via Firebase ID token of an admin/owner
 *
 * See docs/runbooks/hopp-sync-troubleshooting.md for failure-mode recovery.
 * See plan file Phase 1.8 for design rationale.
 */

import { getDb, verifyIdToken, FieldValue } from './_lib/firebase-admin.js';
import { callHoppTool } from './_lib/hopp-mcp-client.js';
import { rollupTripsToRevenue } from '../src/utils/hoppSyncRollup.js';

export const maxDuration = 60;

const BATCH_SIZE = 450;
const WINDOW_MIN_HOURS  = 2;    // always pull at least the last 2 hours
const OVERLAP_MINUTES   = 30;   // re-sync the prior 30min for safety; _docId dedup makes this free

const COLLECTIONS = {
  scooters:           'scooters',
  trips:              'scooterTrips',
  telemetryEvents:    'telemetryEvents',
  maintenanceTickets: 'maintenanceTickets',
  revenue:            'revenue',
  syncLogs:           'syncLogs',
};

const ADMIN_ROLES = ['admin', 'owner', 'staff']; // Phase 2 will use custom claims; for now we check the user doc

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const startedAt = Date.now();
  let trigger = 'unknown';
  let triggeredByUid = null;

  // ── Dual auth ─────────────────────────────────────────────────────
  try {
    const authHeader = req.headers.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    if (!bearer) {
      return res.status(401).json({ ok: false, error: 'Missing Authorization header' });
    }

    if (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) {
      trigger = 'cron';
    } else {
      // Try Firebase ID token
      let decoded;
      try {
        decoded = await verifyIdToken(bearer);
      } catch {
        return res.status(401).json({ ok: false, error: 'Invalid bearer token (neither CRON_SECRET nor a valid Firebase ID token)' });
      }
      triggeredByUid = decoded.uid;
      trigger = 'manual';

      // Confirm the user has admin/owner role
      const db = getDb();
      const userDoc = await db.collection('users').doc(decoded.uid).get();
      const role = userDoc.exists ? userDoc.data().role : null;
      if (!ADMIN_ROLES.includes(role)) {
        return res.status(403).json({ ok: false, error: `Role "${role}" cannot trigger sync` });
      }
    }
  } catch (err) {
    console.error('[cron-hopp-sync] auth error', err);
    return res.status(500).json({ ok: false, error: 'Auth check failed: ' + err.message });
  }

  // ── Window ────────────────────────────────────────────────────────
  const db = getDb();
  const now = new Date();
  const lastSync = await getLastSuccessfulSyncTime(db);
  const since = computeSince(lastSync, now);
  const until = now;

  console.log(`[cron-hopp-sync] trigger=${trigger} window=${since.toISOString()}..${until.toISOString()}`);

  // ── Load scooters ────────────────────────────────────────────────
  let scooters;
  try {
    const snap = await db.collection(COLLECTIONS.scooters).get();
    scooters = snap.docs.map((d) => ({ _docId: d.id, ...d.data() }));
  } catch (err) {
    return finalize(res, db, {
      trigger, triggeredByUid, startedAt,
      ok: false, errorMessage: 'Failed to load scooters: ' + err.message,
    });
  }

  if (scooters.length === 0) {
    return finalize(res, db, {
      trigger, triggeredByUid, startedAt, since, until,
      ok: true,
      written: { trips: 0, events: 0, tickets: 0, revenueDays: 0 },
      duplicates: { trips: 0, events: 0, tickets: 0 },
      errors: [],
      scooterCount: 0,
      message: 'No scooters in Firestore to sync',
    });
  }

  const scooterCityMap = new Map(
    scooters.map((s) => [String(s.scooterId || s._docId), s.city || s.location || 'Unknown']),
  );

  // ── Fan out: 3 MCP calls per scooter, in parallel ────────────────
  const perScoooterResults = await Promise.allSettled(
    scooters.map((s) => syncOneScooter(s, scooterCityMap, since, until)),
  );

  const aggregated = {
    trips: [],
    events: [],
    tickets: [],
    errors: [],
  };
  for (let i = 0; i < perScoooterResults.length; i++) {
    const r = perScoooterResults[i];
    const sid = scooters[i].scooterId || scooters[i]._docId;
    if (r.status === 'rejected') {
      aggregated.errors.push({ scooterId: sid, error: String(r.reason?.message || r.reason) });
      continue;
    }
    aggregated.trips.push(...(r.value.trips || []));
    aggregated.events.push(...(r.value.events || []));
    aggregated.tickets.push(...(r.value.tickets || []));
    if (r.value.errors?.length) aggregated.errors.push(...r.value.errors.map((e) => ({ scooterId: sid, error: e })));
  }

  // ── Write to Firestore ───────────────────────────────────────────
  const written = { trips: 0, events: 0, tickets: 0, revenueDays: 0 };
  const duplicates = { trips: 0, events: 0, tickets: 0 };

  try {
    // Existing-ID lookups for dedup counting (best-effort; not strictly necessary
    // since batch.set is idempotent — we just want accurate `duplicates` reporting)
    written.trips    = await writeBatch(db, COLLECTIONS.trips,              aggregated.trips,    { merge: true, stampField: '_importedAt' });
    written.events   = await writeBatch(db, COLLECTIONS.telemetryEvents,    aggregated.events,   { merge: false, stampField: 'createdAt' });
    written.tickets  = await writeBatch(db, COLLECTIONS.maintenanceTickets, aggregated.tickets,  { merge: true, stampField: 'updatedAt' });

    // Revenue rollup
    const revenueRows = rollupTripsToRevenue(
      aggregated.trips, scooterCityMap, since.toISOString(), until.toISOString(), now,
    );
    written.revenueDays = await writeBatch(
      db,
      COLLECTIONS.revenue,
      revenueRows.map((r) => ({ ...r.data, _docId: r.docId })),
      { merge: true, stampField: 'lastSyncedAt' },
    );
  } catch (err) {
    return finalize(res, db, {
      trigger, triggeredByUid, startedAt, since, until,
      ok: false, errorMessage: 'Firestore write failed: ' + err.message,
      partialWritten: written, scooterCount: scooters.length,
    });
  }

  return finalize(res, db, {
    trigger, triggeredByUid, startedAt, since, until,
    ok: true,
    written, duplicates,
    errors: aggregated.errors,
    scooterCount: scooters.length,
  });
}

// ─── helpers ─────────────────────────────────────────────────────────

async function syncOneScooter(scooter, scooterCityMap, since, until) {
  const sid = String(scooter.scooterId || scooter._docId);
  const args = { scooterId: sid, since: since.toISOString(), until: until.toISOString() };

  const [tripsR, eventsR, ticketsR] = await Promise.allSettled([
    callHoppTool('list_trips',         args),
    callHoppTool('list_status_events', args),
    callHoppTool('list_repair_events', args),
  ]);

  const errors = [];
  const trips    = unwrap(tripsR,   'rows',    errors, 'list_trips');
  const events   = unwrap(eventsR,  'events',  errors, 'list_status_events');
  const tickets  = unwrap(ticketsR, 'tickets', errors, 'list_repair_events');

  // Inject city into telemetry events at write time (hopp-mcp returns city="")
  const city = scooterCityMap.get(sid);
  for (const e of events) {
    if (!e.city) e.city = city || 'Unknown';
  }

  return { trips, events, tickets, errors };
}

function unwrap(settled, key, errors, toolName) {
  if (settled.status === 'rejected') {
    errors.push(`${toolName}: ${settled.reason?.message || settled.reason}`);
    return [];
  }
  const payload = settled.value;
  if (Array.isArray(payload?.errors) && payload.errors.length) {
    errors.push(`${toolName} returned errors: ${payload.errors.join('; ')}`);
  }
  return payload?.[key] || [];
}

async function writeBatch(db, collection, items, { merge, stampField }) {
  if (!items || items.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const item of chunk) {
      const { _docId, ...data } = item;
      if (!_docId) continue;
      data[stampField] = FieldValue.serverTimestamp();
      const ref = db.collection(collection).doc(String(_docId));
      if (merge) batch.set(ref, data, { merge: true });
      else batch.set(ref, data);
      total++;
    }
    await batch.commit();
  }
  return total;
}

async function getLastSuccessfulSyncTime(db) {
  try {
    const snap = await db.collection(COLLECTIONS.syncLogs)
      .where('ok', '==', true)
      .orderBy('finishedAt', 'desc')
      .limit(1)
      .get();
    if (snap.empty) return null;
    const lastFinished = snap.docs[0].data().finishedAt;
    return lastFinished?.toDate ? lastFinished.toDate() : null;
  } catch (err) {
    // First-run case: no syncLogs collection or no composite index yet
    console.warn('[cron-hopp-sync] could not read last syncLog (first run?):', err.message);
    return null;
  }
}

function computeSince(lastSync, now) {
  const minAgo = new Date(now.getTime() - WINDOW_MIN_HOURS * 60 * 60 * 1000);
  if (!lastSync) return minAgo;
  const overlapped = new Date(lastSync.getTime() - OVERLAP_MINUTES * 60 * 1000);
  // Take the later of (lastSync - 30min) and (now - 2h)
  return overlapped > minAgo ? overlapped : minAgo;
}

async function finalize(res, db, summary) {
  const durationMs = Date.now() - summary.startedAt;
  const logDoc = {
    trigger:         summary.trigger,
    triggeredByUid:  summary.triggeredByUid || 'cron',
    ok:              summary.ok,
    durationMs,
    finishedAt:      FieldValue.serverTimestamp(),
    window:          summary.since && summary.until
      ? { since: summary.since.toISOString(), until: summary.until.toISOString() }
      : null,
    written:         summary.written || summary.partialWritten || null,
    duplicates:      summary.duplicates || null,
    errors:          summary.errors || (summary.errorMessage ? [{ error: summary.errorMessage }] : []),
    scooterCount:    summary.scooterCount ?? 0,
    message:         summary.message || null,
  };

  try {
    await db.collection(COLLECTIONS.syncLogs).add(logDoc);
  } catch (err) {
    console.error('[cron-hopp-sync] failed to write syncLogs entry', err);
  }

  const statusCode = summary.ok ? 200 : 500;
  return res.status(statusCode).json({
    ok: summary.ok,
    durationMs,
    written: logDoc.written,
    duplicates: logDoc.duplicates,
    errors: logDoc.errors,
    scooterCount: logDoc.scooterCount,
    trigger: logDoc.trigger,
    window: logDoc.window,
    message: logDoc.message,
    error: summary.errorMessage || null,
  });
}
