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
import { createClient } from '@supabase/supabase-js';
import { toSupabaseRow } from '../src/lib/supabaseRowMap.js';

export const maxDuration = 60;

// ADR-0013: the cron also dual-writes trips + revenue to Supabase (service-role,
// bypasses RLS). Single-tenant cron stamps a fixed org; override via OMNI_ORG_ID.
const ORG_ID = process.env.OMNI_ORG_ID || 'mg-executive-org';

const BATCH_SIZE = 450;
// Sync window starts at 00:00 UTC this many days back. The revenue rollup only
// emits a day's row when the window FULLY covers that day, so the window must be
// day-aligned (not "last 2h"). A fixed day-aligned lookback also removes the need
// for a "last successful sync" composite index. Trips dedupe by _docId and revenue
// upserts idempotently, so re-pulling these days each run is cheap + safe.
const LOOKBACK_DAYS = 2;

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

  // ── Window (day-aligned: 00:00 UTC, LOOKBACK_DAYS back → now) ─────
  const db = getDb();
  const now = new Date();
  const startOfTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
  const since = new Date(startOfTodayUtc - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
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

  // ── Bulk pull: ONE call per tool (no scooterId), SEQUENTIAL ──────
  // Hopp's list_trips + list_repair_events each return ALL scooters in a single
  // call, so we no longer fan out 3 × N requests. Sequential (not parallel) on
  // purpose: Hopp refresh tokens are one-time-use, and firing ~200 calls at once
  // made them stampede the token rotation → mass 401 ("all candidates failed").
  // The first call refreshes the token; the next reuses it.
  //
  // list_status_events is intentionally NOT pulled: the Hopp operator account
  // lacks the vehicleEvents privilege (returns NOT_AUTHORIZED) and that query is
  // per-scooter only. Telemetry keeps flowing via the PME CSV importer — re-enable
  // here (per-scooter) once Hopp grants the privilege.
  const range = { since: since.toISOString(), until: until.toISOString() };
  const aggregated = { trips: [], events: [], tickets: [], errors: [] };
  let pullsOk = 0;

  try {
    const r = await callHoppTool('list_trips', range);
    aggregated.trips = Array.isArray(r?.rows) ? r.rows : [];
    pullsOk++;
    if (Array.isArray(r?.errors) && r.errors.length) {
      aggregated.errors.push(...r.errors.map((e) => ({ tool: 'list_trips', error: String(e) })));
    }
  } catch (err) {
    aggregated.errors.push({ tool: 'list_trips', error: String(err?.message || err) });
  }

  try {
    const r = await callHoppTool('list_repair_events', range);
    aggregated.tickets = Array.isArray(r?.tickets) ? r.tickets : [];
    pullsOk++;
    if (Array.isArray(r?.errors) && r.errors.length) {
      aggregated.errors.push(...r.errors.map((e) => ({ tool: 'list_repair_events', error: String(e) })));
    }
  } catch (err) {
    aggregated.errors.push({ tool: 'list_repair_events', error: String(err?.message || err) });
  }

  // If EVERY Hopp pull failed (e.g. the refresh token is exhausted), this is a HARD failure —
  // report ok:false so the UI shows a real error (not "up to date — nothing new") and the cron
  // failure-alert fires, instead of silently logging a green zero-data sync.
  if (pullsOk === 0) {
    return finalize(res, db, {
      trigger, triggeredByUid, startedAt, since, until,
      ok: false,
      errorMessage: 'All Hopp pulls failed — ' + (aggregated.errors[0]?.error || 'unknown error'),
      errors: aggregated.errors,
      scooterCount: scooters.length,
    });
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

    // Revenue rollup — #172: rollup now returns { rows, errors }
    const { rows: revenueRows, errors: rollupErrors } = rollupTripsToRevenue(
      aggregated.trips, scooterCityMap, since.toISOString(), until.toISOString(), now,
    );
    if (rollupErrors.length) {
      console.warn('[cron-hopp-sync] rollup skipped trips:', rollupErrors);
    }
    written.revenueDays = await writeBatch(
      db,
      COLLECTIONS.revenue,
      revenueRows.map((r) => ({ ...r.data, _docId: r.docId })),
      { merge: true, stampField: 'lastSyncedAt' },
    );

    // ── ADR-0013: best-effort dual-write trips + revenue to Supabase ─────
    // Inner try → a Supabase hiccup never fails the authoritative Firestore sync.
    // source_doc_id = the raw Firestore doc id, so this dedups against the backfill.
    try {
      const supa = supabaseAdmin();
      if (supa) {
        await upsertSupabase(supa, 'scooter_trips', aggregated.trips
          .map((t) => {
            const { _docId, ...data } = t;
            return _docId
              ? toSupabaseRow('scooterTrips', ORG_ID, String(_docId), { ...data, orgId: ORG_ID })
              : null;
          })
          .filter(Boolean));
        await upsertSupabase(supa, 'revenue_days', revenueRows
          .map((r) => toSupabaseRow('revenue', ORG_ID, String(r.docId), { ...r.data, orgId: ORG_ID })));
      }
    } catch (e) {
      console.warn('[cron-hopp-sync] Supabase dual-write skipped:', e?.message || e);
    }
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

// ADR-0013 — lazy service-role Supabase client (null when env unset → dual-write no-ops).
let _supa = null;
function supabaseAdmin() {
  if (_supa) return _supa;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _supa = createClient(url, key, { auth: { persistSession: false } });
  return _supa;
}

async function upsertSupabase(supa, table, rows) {
  if (!rows || !rows.length) return;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supa.from(table).upsert(rows.slice(i, i + 500), { onConflict: 'source_doc_id' });
    if (error) { console.warn(`[cron-hopp-sync] supabase ${table}: ${error.message}`); break; }
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Layer C (Hopp bulletproofing) — email an alert when an UNATTENDED (cron) sync hard-fails
 * or hits a Hopp auth error. Manual Refresh-button failures are NOT emailed (the user sees
 * those in the toast). Skips silently if RESEND_API_KEY / ALERT_EMAIL aren't configured.
 */
async function maybeSendFailureAlert(summary) {
  if (summary.trigger !== 'cron') return;
  const errs = (summary.errors || []).map((e) => e.error || e).join('; ') || summary.errorMessage || '';
  const isAuthErr = /token|refresh|401|unauthor/i.test(errs);
  if (summary.ok && !isAuthErr) return; // clean run, nothing to alert

  const to = process.env.ALERT_EMAIL;
  const apiKey = process.env.RESEND_API_KEY;
  if (!to || !apiKey) {
    console.warn('[cron-hopp-sync] sync failed but no alert sent — set ALERT_EMAIL + RESEND_API_KEY in Vercel to enable email alerts.');
    return;
  }
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'Omni <noreply@mgexecutive.app>',
      to: [to],
      subject: `⚠️ Omni — Hopp auto-sync failed${isAuthErr ? ' (token needs refresh)' : ''}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px">
          <h2 style="color:#A0521D;margin:0 0 8px">Hopp auto-sync failed</h2>
          <p style="color:#4a5568">The scheduled Hopp sync at ${escapeHtml(new Date().toISOString())} did not complete cleanly.</p>
          <p style="color:#1a202c"><b>Error:</b> ${escapeHtml(errs.slice(0, 500)) || 'unknown'}</p>
          ${isAuthErr ? `<div style="background:#FEF3C7;border:1px solid #D97706;border-radius:6px;padding:12px 16px;margin:12px 0;color:#1a202c">
            <b>Likely fix (~30 sec):</b> Hopp has rotated past every stored refresh token. Grab a fresh one from
            <code>opp.hopp.bike → DevTools → Application → Local Storage → "refreshToken"</code> and set
            <code>HOPP_REFRESH_TOKEN</code> in the <b>hopp-mcp</b> Vercel project. Full steps in the
            hopp-sync-troubleshooting runbook.
          </div>` : ''}
          <p style="color:#718096;font-size:13px">Scooters: ${summary.scooterCount ?? 0} · Manual CSV import remains available as a fallback. — Omni ops</p>
        </div>`,
    });
    console.log('[cron-hopp-sync] failure alert emailed to', to);
  } catch (e) {
    console.error('[cron-hopp-sync] failed to send failure alert:', e.message);
  }
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

  // Layer C — alert on unattended (cron) failures. Awaited so it sends before the
  // serverless function freezes. No-op for clean runs + manual triggers.
  await maybeSendFailureAlert({ ...summary, durationMs });

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
