#!/usr/bin/env node
/**
 * backfill-firestore-to-supabase.mjs — one-time historical copy of the five
 * time-series collections from Firestore into Supabase Postgres (ADR-0013).
 *
 * Modeled on scripts/backfill-org-id.mjs: dry-run by DEFAULT, idempotent, resumable.
 * Idempotency key = `source_doc_id` (the Firestore document id) with
 * `ON CONFLICT (source_doc_id) DO NOTHING`, so re-running never duplicates.
 *
 *   Reads  (Firestore admin):  FIREBASE_SERVICE_ACCOUNT_KEY (JSON) | GOOGLE_APPLICATION_CREDENTIALS (path)
 *   Writes (Supabase):         SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY  (service role bypasses RLS — server only)
 *
 * Usage (from scooter-fleet-costs/):
 *   node scripts/backfill-firestore-to-supabase.mjs                 # dry run, all 5 collections
 *   node scripts/backfill-firestore-to-supabase.mjs --commit        # write
 *   node scripts/backfill-firestore-to-supabase.mjs --only revenue,scooterTrips --commit
 *   node scripts/backfill-firestore-to-supabase.mjs --org-id mg-executive-org --commit
 *
 * --org-id sets the org_id for docs that don't yet carry an `orgId` field (the
 * Milestone B stamp may not have run in prod). It MUST equal the production org's
 * id / the `orgId` custom claim, or RLS will hide the rows from the app.
 */
import admin from 'firebase-admin';
import { createClient } from '@supabase/supabase-js';
import { toSupabaseRow, SUPABASE_TABLE } from '../src/lib/supabaseRowMap.js';

// ── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const flag = (name, def = null) => {
  const i = args.indexOf(name);
  const v = args[i + 1];
  return i >= 0 && v !== undefined && !v.startsWith('--') ? v : def;
};
const DEFAULT_ORG_ID = flag('--org-id', 'mg-executive-org');
const ONLY = (flag('--only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const PAGE = Number(flag('--page', '1000'));
if (!Number.isFinite(PAGE) || PAGE <= 0) throw new Error('--page must be a positive integer');


// ── clients ───────────────────────────────────────────────────────────────────
function initFirestore() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (raw) {
      admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({ credential: admin.credential.applicationDefault() });
    } else {
      throw new Error('Set FIREBASE_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS.');
    }
  }
  return admin.firestore();
}

function initSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function backfillCollection(db, sb, name) {
  const table = SUPABASE_TABLE[name];
  if (!table) throw new Error(`backfillCollection: no mapping for collection "${name}"`);
  let total = 0;
  let written = 0;
  let buffer = [];
  let last = null;

  // Connectivity probe: verifies reachability, service-role RLS bypass, and that
  // source_doc_id column exists. Runs in both dry-run and commit modes.
  const { error: probeErr } = await sb.from(table).select('source_doc_id').limit(0);
  if (probeErr) throw new Error(`[${name}→${table}] connectivity/schema probe failed: ${probeErr.message}`);

  const flush = async () => {
    if (!buffer.length) return;
    if (COMMIT) {
      const { error, count } = await sb.from(table).upsert(buffer, {
        onConflict: 'source_doc_id',
        ignoreDuplicates: true,
        count: 'exact',
      });
      if (error) throw new Error(`[${name}→${table}] upsert failed: ${error.message} | code=${error.code ?? ''} | details=${error.details ?? ''} | hint=${error.hint ?? ''}`);
      written += (count ?? 0);
    }
    buffer = [];
  };

  // Paginated reads — avoids loading the entire collection into memory at once
  // and stays under the Spark 50K/day read quota per run. Each page is PAGE docs.
  for (;;) {
    let q = db.collection(name)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    last = snap.docs[snap.docs.length - 1].id;
    total += snap.size;

    for (const docSnap of snap.docs) {
      const raw = docSnap.data();
      const orgId = raw.orgId || DEFAULT_ORG_ID;
      const row = toSupabaseRow(name, orgId, docSnap.id, raw);
      buffer.push(row);
      if (buffer.length >= PAGE) await flush();
    }

    if (snap.size < PAGE) break; // last page
  }
  await flush();
  return { name, table, total, written };
}

// ── main ───────────────────────────────────────────────────────────────────────
async function main() {
  const names = (ONLY.length ? ONLY : Object.keys(SUPABASE_TABLE)).filter((n) => {
    if (!SUPABASE_TABLE[n]) { console.warn(`⚠️  unknown collection "${n}" — skipping`); return false; }
    return true;
  });

  console.log(`\n${COMMIT ? '🔴 COMMIT' : '🟢 DRY RUN'} — Firestore → Supabase backfill`);
  console.log(`   org_id fallback: ${DEFAULT_ORG_ID}`);
  console.log(`   collections:     ${names.join(', ')}\n`);

  const db = initFirestore();
  const sb = initSupabase();

  const report = [];
  for (const name of names) {
    process.stdout.write(`   ${name} … `);
    const r = await backfillCollection(db, sb, name);
    report.push(r);
    console.log(`${r.total} docs → ${COMMIT ? `${r.written} upserted` : `${r.total} WOULD upsert`} into ${r.table}`);
  }

  const grand = report.reduce((s, r) => s + r.total, 0);
  console.log(`\n${COMMIT ? '✅ committed' : '🟢 dry run'} — ${grand} total docs across ${report.length} collections.`);
  if (!COMMIT) console.log('   Re-run with --commit to write. Idempotent (ON CONFLICT source_doc_id DO NOTHING).');
  console.log(`   (Read ~${grand} Firestore docs against the Spark 50K/day quota.)\n`);
}

main().catch((e) => { console.error('\n❌', e.code ?? '', e.message, e.details ?? '', e.hint ?? ''); process.exit(1); });
