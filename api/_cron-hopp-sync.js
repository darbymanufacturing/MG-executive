/**
 * cron-hopp-sync — pulls latest trips / status events / repair tickets from
 * the deployed hopp-mcp server (https://hopp-mcp.vercel.app/api/mcp) and
 * upserts them into Firestore. Rolls up trips into the `revenue` collection
 * as a side effect. Writes a `syncLogs` summary doc per run.
 *
 * Dual-trigger:
 *   1. Vercel cron (daily 05:30 UTC, `"30 5 * * *"` in vercel.json) — auth via `Authorization: Bearer ${CRON_SECRET}`
 *   2. User-triggered Refresh button in TopBar — auth via Firebase ID token of an admin/owner
 *
 * See docs/runbooks/hopp-sync-troubleshooting.md for failure-mode recovery.
 * See plan file Phase 1.8 for design rationale.
 */

import { getDb, FieldValue } from './_lib/firebase-admin.js';
import { requireCronOrUser } from './_lib/require-auth.js';
import { callHoppTool } from './_lib/hopp-mcp-client.js';
import { rollupTripsToRevenue } from '../src/utils/hoppSyncRollup.js';
import { createClient } from '@supabase/supabase-js';
import { toSupabaseRow } from '../src/lib/supabaseRowMap.js';

export const maxDuration = 60;

// ADR-0013: the cron also dual-writes trips + revenue to Supabase (service-role,
// bypasses RLS). OMNI_ORG_ID is required — no hardcoded fallback to prevent
// cross-tenant data corruption when a second org is added (BUG #382).
const ORG_ID = process.env.OMNI_ORG_ID;

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

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const startedAt = Date.now();

  // ── Dual auth (constant-time compare via requireCronOrUser — #548) ──
  // requireCronOrUser uses timingSafeEqual from node:crypto internally, eliminating
  // the timing side-channel that existed when we did `bearer === process.env.CRON_SECRET`.
  const auth = await requireCronOrUser(req, res);
  if (!auth) return; // requireCronOrUser already sent 401/403

  const trigger = auth.trigger;
  const triggeredByUid = auth.uid ?? null;

  // ── Window (day-aligned: 00:00 UTC, LOOKBACK_DAYS back → now) ─────
  const db = getDb();
  const now = new Date();
  const startOfTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
  const since = new Date(startOfTodayUtc - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const until = now;

  console.log(`[cron-hopp-sync] trigger=${trigger} window=${since.toISOString()}..${until.toISOString()}`);

  // ── Load scooters ────────────────────────────────────────────────
  // BUG #346 — field-mask projection: only fetch the three fields actually consumed
  // downstream (scooterId → scooterCityMap key, city/location → city value, orgId →
  // multi-org guard). At 10 k scooters/client this saves ~7.2 M full-doc reads/month.
  // TODO (BUG #346 Layer 2): eliminate per-scooter reads entirely by maintaining a
  // config/fleet.scooterIndex singleton doc {scooterIds, cityMap} via an onCreate/
  // onDelete Firestore trigger on the scooters collection — cron reads 1 doc not N.
  let scooters;
  try {
    const snap = await db.collection(COLLECTIONS.scooters).select('scooterId', 'city', 'location', 'orgId', 'fleetId').get();
    scooters = snap.docs.map((d) => ({ _docId: d.id, ...d.data() }));
  } catch (err) {
    return finalize(res, db, {
      trigger, triggeredByUid, startedAt,
      ok: false, errorMessage: 'Failed to load scooters: ' + err.message,
    });
  }

  // BUG #382 — OMNI_ORG_ID is required; fail loudly rather than silently corrupt
  // cross-tenant data by stamping rows with a wrong org.
  if (!ORG_ID) {
    return finalize(res, db, {
      trigger, triggeredByUid, startedAt,
      ok: false, errorMessage: 'OMNI_ORG_ID env var is required — set it in the Vercel project environment variables',
    });
  }

  if (scooters.length === 0) {
    return finalize(res, db, {
      trigger, triggeredByUid, startedAt, since, until,
      ok: true,
      written: { trips: 0, events: 0, tickets: 0, revenueDays: 0 },
      errors: [],
      scooterCount: 0,
      message: 'No scooters in Firestore to sync',
    });
  }

  // #369 — drop the 'Unknown' fallback: a scooter with no city/location maps to null
  // so the rollup's `if (!city) continue;` guard skips it instead of emitting a phantom
  // `${date}_Unknown` revenue doc (which #172 fixed for the absent-from-map path).
  const scooterCityMap = new Map(
    scooters.map((s) => [String(s.scooterId || s._docId), s.city || s.location || null]),
  );

  // #565 — fleet attribution: map scooterId → fleetId so every written row carries
  // both orgId (tenant isolation) and fleetId (within-org fleet isolation).
  const scooterFleetMap = new Map(
    scooters.map((s) => [String(s.scooterId || s._docId), s.fleetId ?? null]),
  );

  // BUG #382 — multi-org guard: if any scooter belongs to a different org than the
  // configured OMNI_ORG_ID, abort rather than stamp all their data with the wrong org_id.
  // This is a safe outage instead of silent cross-tenant data corruption.
  const distinctOrgIds = new Set(scooters.map((s) => s.orgId).filter(Boolean));
  const foreignOrgs = [...distinctOrgIds].filter((id) => id !== ORG_ID);
  if (foreignOrgs.length > 0) {
    return finalize(res, db, {
      trigger, triggeredByUid, startedAt,
      ok: false,
      errorMessage: `Multi-org Hopp sync not yet supported — aborting to prevent cross-tenant corruption; deploy per-org cron first. Foreign orgIds detected: ${foreignOrgs.join(', ')}`,
    });
  }

  // ── Bulk pull: ONE call per tool (no scooterId), SEQUENTIAL ──────
  // Hopp's list_trips + list_repair_events each return ALL scooters in a single
  // call, so we no longer fan out 3 × N requests. Sequential (not parallel) on
  // purpose: Hopp refresh tokens are one-time-use, and firing ~200 calls at once
  // made them stampede the token rotation → mass 401 ("all candidates failed").
  // The first call refreshes the token; the next reuses it.
  //
  // list_status_events is per-scooter only (no bulk endpoint — confirmed by
  // hopp-mcp-client.js and backfill-hopp-history.mjs). It was disabled in commit
  // a33f45a because #315 returned NOT_AUTHORIZED. #315 is now RESOLVED (2026-05-29):
  // the root cause was our own bug (missing getVehicleByCode() lookup) not a Hopp
  // privilege gap. Re-enabled below (per-scooter, sequential). See #368.

  // BUG #358 — each callHoppTool's per-call timeoutMs must be subordinate to the
  // Vercel maxDuration=60 s ceiling. Two sequential 45 s calls would budget 90 s
  // worst-case, causing the runtime to kill the function before the second call
  // even fires its AbortController. remainingMs() shrinks each call's timeout to
  // whatever wall-clock time is left, with a 5 000 ms floor so the call can at
  // least attempt and report a timeout error gracefully.
  const CRON_BUDGET_MS = (maxDuration - 2) * 1000; // 58 000 ms — 2 s headroom for finalize/write
  function remainingMs() {
    return Math.max(5000, CRON_BUDGET_MS - (Date.now() - startedAt));
  }

  const range = { since: since.toISOString(), until: until.toISOString() };
  const aggregated = { trips: [], events: [], tickets: [], errors: [] };
  let pullsOk = 0;

  try {
    const r = await callHoppTool('list_trips', range, { timeoutMs: remainingMs() });
    aggregated.trips = Array.isArray(r?.rows) ? r.rows : [];
    pullsOk++;
    if (Array.isArray(r?.errors) && r.errors.length) {
      aggregated.errors.push(...r.errors.map((e) => ({ tool: 'list_trips', error: String(e) })));
    }
  } catch (err) {
    aggregated.errors.push({ tool: 'list_trips', error: String(err?.message || err) });
  }

  try {
    const r = await callHoppTool('list_repair_events', range, { timeoutMs: remainingMs() });
    aggregated.tickets = Array.isArray(r?.tickets) ? r.tickets : [];
    pullsOk++;
    if (Array.isArray(r?.errors) && r.errors.length) {
      aggregated.errors.push(...r.errors.map((e) => ({ tool: 'list_repair_events', error: String(e) })));
    }
  } catch (err) {
    aggregated.errors.push({ tool: 'list_repair_events', error: String(err?.message || err) });
  }

  // ── Per-scooter sequential pull: list_status_events (#368 re-enable) ──────
  // No bulk endpoint exists — must be called once per scooter. Sequential (not
  // parallel) for the same rotating-token reason as the bulk calls above.
  // A per-scooter failure pushes to aggregated.errors and continues (does NOT
  // abort the run or affect pullsOk — events are additive, not required for a
  // successful sync). City is injected from scooterCityMap before write to
  // match the backfill pattern (backfill-hopp-history.mjs:214).
  {
    let eventsOk = 0;
    for (const [scooterId] of scooterCityMap) {
      try {
        const r = await callHoppTool('list_status_events', { scooterId, ...range }, { timeoutMs: remainingMs() });
        const evts = Array.isArray(r?.events) ? r.events : [];
        const city = scooterCityMap.get(scooterId) || null;
        aggregated.events.push(...evts.map((evt) => ({ ...evt, city, scooterId })));
        eventsOk++;
        if (Array.isArray(r?.errors) && r.errors.length) {
          aggregated.errors.push(
            ...r.errors.map((e) => ({ tool: 'list_status_events', scooterId, error: String(e) })),
          );
        }
      } catch (err) {
        aggregated.errors.push({
          tool: 'list_status_events',
          scooterId,
          error: String(err?.message || err),
        });
      }
    }
    console.log(
      `[cron-hopp-sync] list_status_events: ${eventsOk}/${scooterCityMap.size} scooters ok, ${aggregated.events.length} events collected`,
    );
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
  // #486 — collect the Supabase dual-write result so syncLogs reports TRUTHFUL parity
  // (writtenChunks / failedChunks) instead of always implying success.
  const supaResult = { trips: null, revenue: null };

  try {
    // BUG #382 — stamp orgId into every Firestore doc so docs are org-scoped (SCHEMA.md: orgId field).
    // #565 — also stamp fleetId derived from scooterFleetMap so fleet attribution is preserved.
    const stampOrg = (items) => items.map((item) => ({
      ...item,
      orgId: ORG_ID,
      fleetId: scooterFleetMap.get(String(item.scooterId ?? '')) ?? null,
    }));
    written.trips    = await writeBatch(db, COLLECTIONS.trips,              stampOrg(aggregated.trips),   { merge: true, stampField: '_importedAt' });
    written.events   = await writeBatch(db, COLLECTIONS.telemetryEvents,    stampOrg(aggregated.events),  { merge: false, stampField: 'createdAt' });
    written.tickets  = await writeBatch(db, COLLECTIONS.maintenanceTickets, stampOrg(aggregated.tickets), { merge: true, stampField: 'updatedAt' });

    // Revenue rollup — #172: rollup now returns { rows, errors }
    const { rows: revenueRows, errors: rollupErrors } = rollupTripsToRevenue(
      aggregated.trips, scooterCityMap, since.toISOString(), until.toISOString(), now,
    );
    if (rollupErrors.length) {
      aggregated.errors.push(
        ...rollupErrors.map((e) => ({ tool: 'rollup', error: String(e) })),
      );
      console.warn('[cron-hopp-sync] rollup skipped trips:', rollupErrors);
    }
    // #565 — derive fleetId for revenue rows: if the rollup bucket carries a scooterId
    // use the fleet map; otherwise (multi-scooter aggregate) stamp null.
    written.revenueDays = await writeBatch(
      db,
      COLLECTIONS.revenue,
      revenueRows.map((r) => ({
        ...r.data,
        orgId: ORG_ID,
        fleetId: r.data.scooterId ? (scooterFleetMap.get(String(r.data.scooterId)) ?? null) : null,
        _docId: r.docId,
      })),
      { merge: true, stampField: 'lastSyncedAt' },
    );

    // ── ADR-0013: best-effort dual-write trips + revenue to Supabase ─────
    // Inner try → a Supabase hiccup never fails the authoritative Firestore sync.
    // source_doc_id = the raw Firestore doc id, so this dedups against the backfill.
    try {
      const supa = supabaseAdmin();
      if (supa) {
        supaResult.trips = await upsertSupabase(supa, 'scooter_trips', aggregated.trips
          .map((t) => {
            const { _docId, ...data } = t;
            return _docId
              ? toSupabaseRow('scooterTrips', ORG_ID, String(_docId), {
                  ...data,
                  orgId: ORG_ID,
                  // #565 — carry fleetId into Supabase rows too
                  fleetId: scooterFleetMap.get(String(data.scooterId ?? '')) ?? null,
                })
              : null;
          })
          .filter(Boolean));
        supaResult.revenue = await upsertSupabase(supa, 'revenue_days', revenueRows
          .map((r) => toSupabaseRow('revenue', ORG_ID, String(r.docId), {
            ...r.data,
            orgId: ORG_ID,
            // #565 — carry fleetId into Supabase revenue rows
            fleetId: r.data.scooterId ? (scooterFleetMap.get(String(r.data.scooterId)) ?? null) : null,
          })));
      }
    } catch (e) {
      console.warn('[cron-hopp-sync] Supabase dual-write skipped:', e?.message || e);
      supaResult.error = String(e?.message || e);
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
    written,
    supabaseWritten: supaResult,
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
  // #486 — return per-chunk outcome so the cron can report honest Supabase parity.
  if (!rows || !rows.length) return { writtenChunks: 0, failedChunks: 0, totalRows: 0 };
  let writtenChunks = 0, failedChunks = 0, totalRows = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supa.from(table).upsert(chunk, { onConflict: 'source_doc_id' });
    // #379 — continue (not break) so a transient chunk failure doesn't drop subsequent chunks
    if (error) { console.warn(`[cron-hopp-sync] supabase ${table} chunk ${i}: ${error.message}`); failedChunks++; continue; }
    writtenChunks++; totalRows += chunk.length;
  }
  return { writtenChunks, failedChunks, totalRows };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
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
    supabaseWritten: summary.supabaseWritten || null, // #486 — truthful Supabase parity per run
    duplicates:      summary.duplicates || null,
    errors:          summary.errors || (summary.errorMessage ? [{ error: summary.errorMessage }] : []),
    scooterCount:    summary.scooterCount ?? 0,
    message:         summary.message || null,
  };

  try {
    const logDocId = `${summary.trigger}_${summary.startedAt}`;
    await db.collection(COLLECTIONS.syncLogs).doc(logDocId).set(logDoc);
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
