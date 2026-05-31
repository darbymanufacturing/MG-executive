#!/usr/bin/env node
/**
 * load-staged-sql-to-supabase.mjs — load the ALREADY-EXPORTED rows (from
 * export-firestore-to-supabase-sql.mjs) into Supabase WITHOUT re-reading Firestore.
 *
 * The exported .sql files embed the rows as a JSON array between $omni$ markers.
 * This reads that array straight out of the files and upserts via supabase-js
 * (service-role key, bypasses RLS), ON CONFLICT (source_doc_id) DO NOTHING-equivalent.
 * → no Firestore reads (Spark-quota-safe), no giant dashboard paste, no agent-context cost.
 *
 *   export SUPABASE_URL="https://nbvfgciyuuclgssnnzlt.supabase.co"
 *   export SUPABASE_SERVICE_ROLE_KEY="<service-role key>"
 *   node scripts/load-staged-sql-to-supabase.mjs --dir <export-dir>            # all tables found
 *   node scripts/load-staged-sql-to-supabase.mjs --dir <export-dir> --table scooter_trips
 *
 * Idempotent: re-running re-upserts the same source_doc_id keys (no duplicates).
 * Prints per-table row count + numeric checksums so you can verify against Postgres.
 */
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); const v = args[i + 1]; return i >= 0 && v !== undefined && !v.startsWith('--') ? v : d; };
const DIR = flag('--dir');
const ONLY_TABLE = flag('--table');
if (!DIR) { console.error('Required: --dir <export-dir>'); process.exit(1); }

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

// Numeric columns to checksum per table (must match rechunk-sql.mjs).
const NUMERIC = {
  scooter_trips: ['cost', 'distance_km', 'duration_minutes'],
  telemetry_events: ['battery_level'],
  spr_events: ['lat', 'lon'],
  spr_weather: [],
  revenue_days: ['total_paid_revenue', 'total_trips', 'unique_users_count', 'unique_vehicles_count'],
};

// Pull the JSON row array out of one exported .sql file (between the $omni$ markers).
function rowsFromSql(text) {
  const start = text.indexOf('$omni$');
  const end = text.lastIndexOf('$omni$');
  if (start < 0 || end <= start) throw new Error('no $omni$ markers');
  const json = text.slice(start + 6, end); // the "[ ... ]" array
  return JSON.parse(json);
}

// Group the per-batch source files by table (scooter_trips.000.sql → scooter_trips).
function tableOf(filename) {
  const m = filename.match(/^([a-z_]+)\.\d+\.sql$/);
  return m ? m[1] : null;
}

async function main() {
  const dir = resolve(DIR);
  const files = readdirSync(dir).filter((f) => tableOf(f) && (!ONLY_TABLE || tableOf(f) === ONLY_TABLE)).sort();
  if (!files.length) { console.error(`No <table>.NNN.sql files in ${dir}`); process.exit(1); }

  const byTable = {};
  for (const f of files) (byTable[tableOf(f)] ??= []).push(f);

  console.log(`\nLoading staged SQL → Supabase (${url})\n  dir: ${dir}\n`);
  for (const [table, tableFiles] of Object.entries(byTable)) {
    const rows = [];
    for (const f of tableFiles) rows.push(...rowsFromSql(readFileSync(join(dir, f), 'utf8')));

    let upserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await sb.from(table).upsert(batch, { onConflict: 'source_doc_id', ignoreDuplicates: true });
      if (error) { console.error(`  ✗ ${table}: ${error.message}`); process.exit(1); }
      upserted += batch.length;
      process.stdout.write(`\r  ${table}: ${upserted}/${rows.length}`);
    }

    // Checksums (match rechunk-sql.mjs: round(sum(col)*1000)).
    const sums = {};
    for (const c of NUMERIC[table] || []) {
      sums[c] = rows.reduce((s, r) => s + Math.round((r[c] == null || r[c] === '' ? 0 : Number(r[c])) * 1000), 0);
    }
    const ids = new Set(rows.map((r) => r.source_doc_id));
    console.log(`\r  ✓ ${table}: ${rows.length} rows upserted (${ids.size} distinct ids)` +
      (Object.keys(sums).length ? `  checksums×1000 ${JSON.stringify(sums)}` : ''));
  }
  console.log('\nDone. Verify in Postgres with the matching `select count(*) … round(sum()*1000)` query.\n');
  process.exit(0);
}

main().catch((e) => { console.error('\n❌ load failed:', e.message); process.exit(1); });
