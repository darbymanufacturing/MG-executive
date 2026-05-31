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

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? null;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? null;

/**
 * Which store backs the five time-series collections: 'firestore' (default) or
 * 'supabase'. A build-time env constant — flip it (and redeploy) to swap reads.
 * Defaulting to 'firestore' means prod behaviour is unchanged until deliberately
 * flipped, and dual-write keeps both stores in sync so the flip is reversible.
 */
export const DATA_LAYER = (import.meta.env.VITE_DATA_LAYER ?? 'firestore').toLowerCase();

/** True once the URL + anon key are present. Dual-write / reads no-op when false. */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

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
  if (!table) return;
  try {
    for (let i = 0; i < entries.length; i += 500) {
      const rows = entries
        .slice(i, i + 500)
        .map((e) => toSupabaseRow(collectionName, orgId, e.id, e.data));
      const { error } = await supabase.from(table).upsert(rows, { onConflict: 'source_doc_id' });
      if (error) { console.warn(`[supabase dual-write] ${table}: ${error.message}`); break; }
    }
  } catch (e) {
    console.warn(`[supabase dual-write] ${table} failed: ${e?.message ?? e}`);
  }
}
