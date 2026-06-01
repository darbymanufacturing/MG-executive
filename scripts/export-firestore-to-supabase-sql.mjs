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
import { fileURLToPath } from 'url';
import { toSupabaseRow, SUPABASE_TABLE } from '../src/lib/supabaseRowMap.js';

const __filename = fileURLToPath(import.meta.url);

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); const v = args[i + 1]; return i >= 0 && v !== undefined && !v.startsWith('--') ? v : d; };
const ORG_ID = flag('--org-id', 'mg-executive-org');
const BATCH = Number(flag('--batch', '500'));
if (!Number.isFinite(BATCH) || BATCH <= 0) throw new Error('--batch must be a positive integer');
// Named collection presets. `operational` = the 14 ADR-0015 collections (config + pow
// both fold into the app_config table). Reads LIVE Firestore so PoW is current.
const PRESETS = {
  operational: [
    'pow_tasks', 'maintenanceTickets', 'maintenanceParts', 'scooters', 'repairSessions',
    'repairProcedures', 'projects', 'decisionGates', 'brainstormIdeas', 'issues',
    'notifications', 'diary', 'costs', 'config', 'pow',
  ],
  timeseries: ['scooterTrips', 'sprEvents', 'sprWeather', 'revenue'], // telemetry excluded (10K)
};
const COLLECTIONS_PRESET = flag('--collections'); // 'operational' | 'timeseries'
const ONLY = (COLLECTIONS_PRESET && PRESETS[COLLECTIONS_PRESET])
  ? PRESETS[COLLECTIONS_PRESET]
  : (flag('--only') || 'scooterTrips,sprEvents,sprWeather,revenue').split(',').map((s) => s.trim()).filter(Boolean);

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

// Operational tables (ADR-0015): only { org_id, source_doc_id, data } are exported —
// the typed/indexed columns (created_at_ts, scooter_id, completed_at) are re-derived
// from `data` by per-table DB triggers on insert, so they must NOT be in the COLS list.
const OPERATIONAL_COLS = [['org_id', 'text'], ['source_doc_id', 'text'], ['data', 'jsonb']];
for (const t of [
  'pow_tasks', 'maintenance_tickets', 'maintenance_parts', 'scooters', 'repair_sessions',
  'repair_procedures', 'projects', 'decision_gates', 'brainstorm_ideas', 'issues',
  'notifications', 'diary', 'costs', 'app_config',
]) {
  COLS[t] = OPERATIONAL_COLS;
}

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
    row[name] = type === 'date'
      ? d.toLocaleDateString('en-CA', { timeZone: 'Europe/Athens' })
      : d.toISOString();
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
  // Pass 1: read each collection from LIVE Firestore, group rows by Supabase table
  // (config + pow both map to app_config, so their rows merge into one file set).
  const rowsByTable = {};
  for (const coll of ONLY) {
    const table = SUPABASE_TABLE[coll];
    if (!table) { console.warn(`⚠️  unknown collection "${coll}" — skipping`); continue; }
    const snap = await db.collection(coll).get(); // 1 read/doc against Spark quota
    const rows = snap.docs.map((d) => {
      const docData = d.data();
      const effectiveOrgId = docData.orgId || ORG_ID;
      if (!docData.orgId) console.warn(`⚠️  doc ${d.id} missing orgId field — falling back to CLI flag "${ORG_ID}"`);
      return normalizeDates(toSupabaseRow(coll, effectiveOrgId, d.id, docData), COLS[table]);
    });
    (rowsByTable[table] ??= []).push(...rows);
    console.log(`  read ${coll.padEnd(18)} → ${table.padEnd(20)} ${String(rows.length).padStart(6)} docs`);
  }

  // Pass 2: write batched, idempotent .sql files per table.
  const summary = [];
  for (const [table, rows] of Object.entries(rowsByTable)) {
    let files = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const part = String(files).padStart(3, '0');
      writeFileSync(resolve(dir, `${table}.${part}.sql`), buildSql(table, rows.slice(i, i + BATCH)));
      files++;
    }
    summary.push({ table, docs: rows.length, files });
  }

  const total = summary.reduce((s, r) => s + r.docs, 0);
  console.log(`\n✓ ${total} docs across ${summary.length} tables → ${dir}`);
  console.log(`  (consumed ~${total} Firestore reads against the Spark 50K/day quota)`);
  console.log(`  Next: run each .sql via the Supabase MCP execute_sql (idempotent, ON CONFLICT DO NOTHING).\n`);
  console.log(`OUTDIR=${dir}`);
  process.exit(0);
}

// Export pure utilities for unit testing (importers get no Firebase side-effects).
export { normalizeDates };

if (process.argv[1] === __filename) {
  main().catch((e) => { console.error('\n❌ export failed:', e.message); process.exit(1); });
}
