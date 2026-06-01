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

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      // supabase-js calls this per-request; returning the live Firebase token makes
      // RLS see the user's orgId claim. Null before auth resolves → RLS denies.
      accessToken: async () => {
        try {
          return (await auth.currentUser?.getIdToken()) ?? null;
        } catch {
          return null;
        }
      },
    })
  : null;

/**
 * Best-effort dual-write to Supabase (ADR-0013). Called AFTER the authoritative
 * Firestore write in each import path, so a Supabase failure NEVER breaks the app
 * — it logs and returns. Idempotent: upsert ON CONFLICT (source_doc_id).
 *
 * @param {string} collectionName  Firestore collection (a key of SUPABASE_TABLE)
 * @param {string} orgId           tenant id (the RLS key)
 * @param {{id: string, data: object}[]} entries  id = full Firestore doc id; data = plain doc
 */
export async function dualWriteSupabase(collectionName, orgId, entries) {
  if (!isSupabaseConfigured || !supabase || !orgId || !entries?.length) return;
  const table = SUPABASE_TABLE[collectionName];
  if (!table) {
    // #483 — an unknown collection is a PROGRAMMING error, not a transient API failure;
    // don't swallow it silently. Loud in dev (fails the test), logged-and-skipped in prod.
    console.error(`[supabase dual-write] unknown collection "${collectionName}" — programming error`);
    if (import.meta.env.DEV) throw new Error(`dualWriteSupabase: unknown collection "${collectionName}"`);
    return;
  }
  for (let i = 0; i < entries.length; i += 500) {
    let rows;
    try {
      rows = entries.slice(i, i + 500).map((e) => toSupabaseRow(collectionName, orgId, e.id, e.data));
    } catch (mapErr) {
      // #483 — a mapper throw is a bug in TYPED_COLUMNS/jsonbSafe; surface loudly in dev.
      console.error(`[supabase dual-write] mapper error on chunk ${i}:`, mapErr);
      if (import.meta.env.DEV) throw mapErr;
      continue; // skip the bad chunk in prod
    }
    try {
      // Overwrite-on-conflict (NOT ignoreDuplicates): a corrected re-import must
      // propagate to Supabase so the two stores stay in sync during the parity window.
      // (#379 — `continue` not `break` so one bad chunk doesn't drop the rest.)
      const { error } = await supabase.from(table).upsert(rows, { onConflict: 'source_doc_id' });
      if (error) { console.warn(`[supabase dual-write] ${table} chunk ${i}: ${error.message}`); continue; }
    } catch (netErr) {
      console.warn(`[supabase dual-write] ${table} chunk ${i} network error: ${netErr?.message ?? netErr}`);
      continue;
    }
  }
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
