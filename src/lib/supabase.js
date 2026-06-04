/**
 * Supabase client — the analytical / time-series data layer (ADR-0013).
 *
 * Five high-volume collections (telemetryEvents, scooterTrips, sprEvents,
 * sprWeather, revenue) move from Firestore to Supabase Postgres because Firestore
 * charges per-document-read and the analytical surfaces scan them routinely
 * (BUG #311 / #378). Everything else stays on Firestore + `useOrgCollection`.
 *
 * AUTH BRIDGE (ADR-0004 / ADR-0013): we do NOT use a Supabase-native session.
 * Firebase Auth stays the only identity provider. supabase-js is given an
 * `accessToken` async hook that returns the *current* Firebase ID token on every
 * request; Supabase verifies it against the Firebase project's JWKS (configured
 * once in the dashboard under Authentication → Third-Party Auth). RLS then reads
 * the org via `auth.jwt() ->> 'orgId'` (the custom claim minted by api/sync-claim).
 * Because the hook reads `auth.currentUser` at call-time, no AuthContext wiring is
 * needed and the token is always fresh; before auth resolves it returns null and
 * RLS fails closed (no rows) — the correct default.
 *
 * The anon/publishable key is public-by-design (RLS is the security boundary). The
 * service-role key NEVER appears here — it is server-only (backfill script + cron).
 */
import { createClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/react';
import { auth } from './firebase.js';
import { toSupabaseRow, SUPABASE_TABLE } from './supabaseRowMap.js';
import { GLOBAL_DATA_LAYER } from './dataLayerConfig.js';

// #491 — trim whitespace: a stray space in a Vercel env var would otherwise point the
// client at a malformed URL; blank/garbage collapses to null ("not configured").
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').trim() || null;
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim() || null;

/**
 * The validated global default store ('firestore' | 'supabase'). Single source =
 * dataLayerConfig (which validates the env value, #492); re-exported here for
 * useOrgTable (time-series, ADR-0013). Per-collection routing is dataLayerConfig.layerFor().
 */
export const DATA_LAYER = GLOBAL_DATA_LAYER;

/** True once the URL + anon key are present AND the URL is well-formed (#491).
 *  Dual-write / reads no-op when false. */
export const isSupabaseConfigured = Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY && /^https:\/\/.+/.test(SUPABASE_URL),
);

// #485 — module-level token cache: all parallel supabase-js requests at mount time
// share one Firebase getIdToken() call instead of each triggering their own refresh.
// The 50-minute TTL means we re-fetch well before the 60-minute Firebase expiry but
// don't call getIdToken() on every query.
let _tok = null;
let _tokExp = 0;
let _tokUser = null; // the auth.currentUser the cached token was minted for
// Invalidate on ANY auth transition (sign-out OR user switch) so a new session never
// reuses the prior user's token — a multi-tenant safety guard. Wrapped defensively so a
// partial/absent `auth` (e.g. a Firebase mock in tests that omits onAuthStateChanged)
// never throws at module load; the cache simply works without sign-out invalidation.
try {
  if (auth && typeof auth.onAuthStateChanged === 'function') {
    auth.onAuthStateChanged(() => { _tok = null; _tokExp = 0; _tokUser = null; });
  }
} catch { /* auth unavailable in this environment — token cache still functions */ }

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      // supabase-js calls this per-request; returning the live Firebase token makes
      // RLS see the user's orgId claim. Null before auth resolves → RLS denies.
      accessToken: async () => {
        // Before auth resolves, currentUser is null — return null so RLS fails
        // closed while the app is loading. This is intentional and silent.
        if (!auth.currentUser) return null;
        // #485 — serve the cached token only when it is still valid AND was minted for
        // the SAME currentUser (binding the token to its user prevents ever handing one
        // user's token to another, independent of the onAuthStateChanged listener).
        if (_tok && _tokUser === auth.currentUser && Date.now() < _tokExp) return _tok;
        try {
          _tok = await auth.currentUser.getIdToken();
          _tokExp = Date.now() + 50 * 60 * 1000; // 50 min
          _tokUser = auth.currentUser;
          return _tok;
        } catch (err) {
          // Auth is resolved but the token fetch failed (offline, expired session,
          // rotated key). Re-throw so supabase-js surfaces a request error that
          // useSupabaseTable can toast + capture, instead of silently going anon.
          Sentry.captureException(err, { tags: { source: 'accessToken' } });
          throw err;
        }
      },
    })
  : null;

/**
 * Best-effort dual-write to Supabase (ADR-0013). Called AFTER the authoritative
 * Firestore write in each import path, so a Supabase failure NEVER breaks the app
 * — it logs and returns. Idempotent: upsert ON CONFLICT (source_doc_id).
 *
 * Returns { written, failed, failedChunks } so callers can detect partial success
 * and emit metrics. (#494 — was void; fire-and-forget callers are unaffected.)
 *
 * @param {string} collectionName  Firestore collection (a key of SUPABASE_TABLE)
 * @param {string} orgId           tenant id (the RLS key)
 * @param {{id: string, data: object}[]} entries  id = full Firestore doc id; data = plain doc
 */
export async function dualWriteSupabase(collectionName, orgId, entries) {
  if (!isSupabaseConfigured || !supabase || !orgId || !entries?.length) {
    return { written: 0, failed: 0, failedChunks: [] };
  }
  const table = SUPABASE_TABLE[collectionName];
  if (!table) {
    // #483 — an unknown collection is a PROGRAMMING error, not a transient API failure;
    // don't swallow it silently. Loud in dev (fails the test), logged-and-skipped in prod.
    console.error(`[supabase dual-write] unknown collection "${collectionName}" — programming error`);
    if (import.meta.env.DEV) throw new Error(`dualWriteSupabase: unknown collection "${collectionName}"`);
    return { written: 0, failed: entries.length, failedChunks: [0] };
  }
  let written = 0;
  let failed = 0;
  const failedChunks = [];
  for (let i = 0; i < entries.length; i += 500) {
    const chunkSize = Math.min(500, entries.length - i);
    let rows;
    try {
      rows = entries.slice(i, i + 500).map((e) => toSupabaseRow(collectionName, orgId, e.id, e.data));
    } catch (mapErr) {
      // #483 — a mapper throw is a bug in TYPED_COLUMNS/jsonbSafe; surface loudly in dev.
      console.error(`[supabase dual-write] mapper error on chunk ${i}:`, mapErr);
      Sentry.captureException(mapErr, { extra: { table, chunkStart: i } }); // #381
      if (import.meta.env.DEV) throw mapErr;
      failed += chunkSize;
      failedChunks.push(i);
      continue; // skip the bad chunk in prod
    }
    try {
      // Overwrite-on-conflict (NOT ignoreDuplicates): a corrected re-import must
      // propagate to Supabase so the two stores stay in sync during the parity window.
      // (#379 — `continue` not `break` so one bad chunk doesn't drop the rest.)
      const { error } = await supabase.from(table).upsert(rows, { onConflict: 'source_doc_id' });
      if (error) {
        // #381 — capture write errors in Sentry so they appear in the dashboard;
        // previously only console.warn which was silently invisible in production.
        console.warn(`[supabase dual-write] ${table} chunk ${i}: ${error.message}`);
        Sentry.captureException(new Error(error.message), { extra: { table, chunkStart: i } });
        failed += chunkSize;
        failedChunks.push(i);
        continue;
      }
      written += rows.length;
    } catch (netErr) {
      // #381 — network errors also captured to Sentry for observability.
      console.warn(`[supabase dual-write] ${table} chunk ${i} network error: ${netErr?.message ?? netErr}`);
      Sentry.captureException(netErr, { extra: { table, chunkStart: i, kind: 'network' } });
      failed += chunkSize;
      failedChunks.push(i);
      continue;
    }
  }
  return { written, failed, failedChunks }; // #494
}

/**
 * Best-effort dual-DELETE by docId (mirrors a Firestore delete to Supabase so the
 * stores don't drift once reads come from Supabase). #479. Logs, never throws.
 */
export async function dualDeleteSupabase(collectionName, orgId, docId) {
  if (!isSupabaseConfigured || !supabase || !orgId || !docId) return;
  const table = SUPABASE_TABLE[collectionName];
  if (!table) return;
  try {
    const { error } = await supabase.from(table).delete().eq('org_id', orgId).eq('source_doc_id', docId);
    if (error) console.warn(`[supabase dual-delete] ${table}: ${error.message}`);
  } catch (e) {
    console.warn(`[supabase dual-delete] ${table} failed: ${e?.message ?? e}`);
  }
}

/**
 * Best-effort dual-CLEAR (scope wipe) for clearAllX paths. #479. `extraFilters` are
 * [col, op, val] tuples (op '=='|'!=' → eq/neq) applied on top of org_id. Logs, never throws.
 */
export async function dualClearSupabase(collectionName, orgId, extraFilters = []) {
  if (!isSupabaseConfigured || !supabase || !orgId) return;
  const table = SUPABASE_TABLE[collectionName];
  if (!table) return;
  try {
    let q = supabase.from(table).delete().eq('org_id', orgId);
    for (const [col, op, val] of extraFilters) {
      q = q[op === '!=' ? 'neq' : 'eq'](col, val);
    }
    const { error } = await q;
    if (error) console.warn(`[supabase dual-clear] ${table}: ${error.message}`);
  } catch (e) {
    console.warn(`[supabase dual-clear] ${table} failed: ${e?.message ?? e}`);
  }
}
