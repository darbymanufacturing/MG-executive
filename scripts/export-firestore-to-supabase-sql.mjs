#!/usr/bin/env node
/**
 * export-firestore-to-supabase-sql.mjs — read the time-series collections from
 * Firestore (admin) and EMIT batched .sql files to disk (no Supabase needed).
 *
 * Companion to backfill-firestore-to-supabase.mjs for the **no-service-role-key**
 * path (ADR-0013): an agent runs the emitted SQL through the Supabase MCP
 * `execute_sql` instead of supabase-js. Each batch is one idempotent
 * `insert … select from jsonb_to_recordset(…) on conflict (source_doc_id) do nothing`,
 * so re-running is safe and converges with the cron/CSV dual-writes.
 *
 *   FIREBASE_SERVICE_ACCOUNT_KEY=… | GOOGLE_APPLICATION_CREDENTIALS=…
 *   node scripts/export-firestore-to-supabase-sql.mjs --only scooterTrips,sprEvents,sprWeather,revenue
 *   node scripts/export-firestore-to-supabase-sql.mjs --batch 500 --org-id mg-executive-org
 *
 * Output: backups/supabase-sql-<stamp>/<table>.NNN.sql  (backups/ is gitignored).
 * Telemetry is excluded by default (10K rows are impractical to push through an
 * agent's context; load it via the keyed backfill script instead).
 */
import admin from 'firebase-admin';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { toSupabaseRow, SUPABASE_TABLE } from '../src/lib/supabaseRowMap.js';

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const ORG_ID = flag('--org-id', 'mg-executive-org');
const BATCH = Number(flag('--batch', '500'));
const ONLY = (flag('--only') || 'scooterTrips,sprEvents,sprWeather,revenue').split(',').map((s) => s.trim()).filter(Boolean);

// Column list + Postgres types per table (the jsonb_to_recordset AS-clause).
// MUST match the live schema (migration omni_timeseries_data_layer). `data` last.
const COLS = {
  telemetry_events: [
    ['org_id', 'text'], ['source_doc_id', 'text'], ['scooter_id', 'text'], ['event_ts', 'timestamptz'],
    ['before_state', 'text'], ['after_state', 'text'], ['reason', 'text'], ['event_type', 'text'],
    ['city', 'text'], ['battery_level', 'numeric'], ['data', 'jsonb'],
  ],
  scooter_trips: [
    ['org_id', 'text'], ['source_doc_id', 'text'], ['scooter_id', 'text'], ['started_at', 'timestamptz'],
    ['ended_at', 'timestamptz'], ['duration_minutes', 'numeric'], ['distance_km', 'numeric'],
    ['cost', 'numeric'], ['is_paid', 'boolean'], ['city', 'text'], ['data', 'jsonb'],
  ],
  spr_events: [
    ['org_id', 'text'], ['source_doc_id', 'text'], ['scooter_id', 'text'], ['datetime', 'timestamptz'],
    ['city', 'text'], ['zone', 'text'], ['lat', 'double precision'], ['lon', 'double precision'],
    ['after_state', 'text'], ['action', 'text'], ['data', 'jsonb'],
  ],
  spr_weather: [
    ['org_id', 'text'], ['source_doc_id', 'text'], ['weather_date', 'date'], ['city', 'text'], ['data', 'jsonb'],
  ],
  revenue_days: [
    ['org_id', 'text'], ['source_doc_id', 'text'], ['revenue_date', 'date'], ['location', 'text'],
    ['total_paid_revenue', 'numeric'], ['total_trips', 'numeric'], ['unique_users_count', 'numeric'],
    ['unique_vehicles_count', 'numeric'], ['data', 'jsonb'],
  ],
};

function initAdmin() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (raw) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) admin.initializeApp();
  else { console.error('Set FIREBASE_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS.'); process.exit(1); }
}

// Force every timestamptz/date typed column to an ISO value Postgres can cast, or null.
function normalizeDates(row, cols) {
  for (const [name, type] of cols) {
    if (type !== 'timestamptz' && type !== 'date') continue;
    const v = row[name];
    if (v === null || v === undefined || v === '') { row[name] = null; continue; }
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) { row[name] = null; continue; }
    row[name] = type === 'date' ? d.toISOString().slice(0, 10) : d.toISOString();
  }
  return row;
}

const pad = (n) => String(n).padStart(2, '0');

function buildSql(table, rows) {
  const cols = COLS[table];
  const list = cols.map(([n]) => n).join(', ');
  const asClause = cols.map(([n, t]) => `${n} ${t}`).join(', ');
  // One row object per line so the Read tool returns the file untruncated
  // (it truncates very long single lines). Dollar-quoted → no escaping needed.
  const json = `[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]`;
  return `insert into ${table} (${list})
select ${list}
from jsonb_to_recordset($omni$${json}$omni$::jsonb) as x(${asClause})
on conflict (source_doc_id) do nothing;
`;
}

async function main() {
  initAdmin();
  const db = admin.firestore();
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const dir = resolve(process.cwd(), 'backups', `supabase-sql-${stamp}`);
  mkdirSync(dir, { recursive: true });

  console.log(`\nExporting → ${dir}\n  org_id=${ORG_ID}  batch=${BATCH}  collections=${ONLY.join(', ')}\n`);
  const summary = [];

  for (const coll of ONLY) {
    const table = SUPABASE_TABLE[coll];
    if (!table) { console.warn(`⚠️  unknown collection "${coll}" — skipping`); continue; }
    const snap = await db.collection(coll).get(); // 1 read/doc against Spark quota
    const rows = snap.docs.map((d) => normalizeDates(toSupabaseRow(coll, ORG_ID, d.id, d.data()), COLS[table]));
    let files = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const part = String(files).padStart(3, '0');
      writeFileSync(resolve(dir, `${table}.${part}.sql`), buildSql(table, rows.slice(i, i + BATCH)));
      files++;
    }
    summary.push({ coll, table, docs: rows.length, files });
    console.log(`  ${coll.padEnd(16)} → ${table.padEnd(16)} ${String(rows.length).padStart(6)} docs · ${files} file(s)`);
  }

  const total = summary.reduce((s, r) => s + r.docs, 0);
  console.log(`\n✓ ${total} docs across ${summary.length} collections → ${dir}`);
  console.log(`  (consumed ~${total} Firestore reads against the Spark 50K/day quota)`);
  console.log(`  Next: run each .sql via the Supabase MCP execute_sql (idempotent, ON CONFLICT DO NOTHING).\n`);
  console.log(`OUTDIR=${dir}`);
  process.exit(0);
}

main().catch((e) => { console.error('\n❌ export failed:', e.message); process.exit(1); });
