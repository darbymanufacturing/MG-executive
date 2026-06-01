/**
 * cron-supabase-parity-check — #494 cross-store safety net (ADR-0013/0015).
 *
 * Daily: count docs per migrated collection in Firestore vs rows in the matching
 * Supabase table, write a `parity_checks/{YYYY-MM-DD}` doc with the per-table diff,
 * and log a warning on any drift. This is the automated tripwire for the dual-write
 * parity window — if a dual-write (or the cutover backfill) silently diverges, the
 * next parity check surfaces it instead of it being discovered after Firestore is
 * decommissioned.
 *
 * Auth: Vercel cron via `Authorization: Bearer ${CRON_SECRET}`.
 * Schedule: daily 06:00 UTC (after the 05:30 Hopp sync settles) — vercel.json.
 *
 * Read-cheap: Firestore uses the count() aggregation (~1 read / 1000 index entries);
 * Supabase uses a head:true exact count (no rows transferred). No e-mail alert (the
 * doc is the record; pre-backfill drift on operational tables is expected, not spam).
 *
 * NOTE (pre-deploy): add `parity_checks` to firestore.rules as server-only
 * (admin-SDK-written, client-denied) + docs/SCHEMA.md before the rules deploy.
 */
import { getDb, FieldValue } from './_lib/firebase-admin.js';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_TABLE } from '../src/lib/supabaseRowMap.js';

export const maxDuration = 60;

// Firestore collection → Supabase table (the migrated set). `config` + `pow` both
// fold into app_config, so their Firestore counts are summed against that one table.
const PAIRS = Object.entries(SUPABASE_TABLE);
const TABLES = [...new Set(Object.values(SUPABASE_TABLE))];

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!process.env.CRON_SECRET || bearer !== process.env.CRON_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized (CRON_SECRET required)' });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return res.status(200).json({ ok: true, skipped: 'Supabase env not configured' });
  }
  const supa = createClient(url, key, { auth: { persistSession: false } });
  const db = getDb();

  const fsByTable = {};
  const supaByTable = {};
  const errors = [];

  // Firestore counts (summed per Supabase table → handles config+pow → app_config).
  for (const [coll, table] of PAIRS) {
    try {
      const snap = await db.collection(coll).count().get();
      fsByTable[table] = (fsByTable[table] || 0) + (snap.data().count || 0);
    } catch (e) {
      errors.push({ coll, where: 'firestore', error: String(e?.message || e) });
    }
  }

  // Supabase exact counts (head:true → no rows transferred).
  for (const table of TABLES) {
    try {
      const { count, error } = await supa.from(table).select('*', { count: 'exact', head: true });
      if (error) throw new Error(error.message);
      supaByTable[table] = count || 0;
    } catch (e) {
      errors.push({ table, where: 'supabase', error: String(e?.message || e) });
    }
  }

  const perTable = TABLES.map((table) => {
    const firestore = fsByTable[table] ?? null;
    const supabase = supaByTable[table] ?? null;
    const diff = (firestore != null && supabase != null) ? firestore - supabase : null;
    return { table, firestore, supabase, diff };
  });
  const drifted = perTable.filter((t) => t.diff != null && t.diff !== 0);
  if (drifted.length) {
    console.warn('[parity-check] cross-store drift:', JSON.stringify(drifted));
  }

  const today = new Date().toISOString().slice(0, 10);
  const doc = {
    checkedAt: FieldValue.serverTimestamp(),
    perTable,
    driftedTables: drifted.map((t) => t.table),
    hasDrift: drifted.length > 0,
    errors,
  };
  try {
    await db.collection('parity_checks').doc(today).set(doc);
  } catch (e) {
    console.error('[parity-check] failed to write parity_checks doc:', e?.message || e);
  }

  return res.status(200).json({ ok: errors.length === 0, hasDrift: drifted.length > 0, perTable, errors });
}
