#!/usr/bin/env node
/**
 * rechunk-sql.mjs — purely LOCAL re-slicer for the .sql files emitted by
 * export-firestore-to-supabase-sql.mjs. No Firestore, no Supabase, no network.
 *
 * Splits the large per-batch INSERT files into smaller chunks that fit in a single
 * Read (so an agent can execute each chunk's EXACT bytes via the Supabase MCP with
 * no hand-transcription across page breaks), and prints aggregate checksums
 * (count + sum of the numeric columns) so the load can be VERIFIED end-to-end:
 * compute the same aggregates in Postgres after loading and compare.
 *
 *   node scripts/rechunk-sql.mjs --dir <export-dir> --table scooter_trips --rows 70
 *
 * Re-uses the source files' exact INSERT header/footer (same column list + AS-clause
 * + ON CONFLICT), so chunks are byte-identical in structure to the validated export
 * — zero new template risk. Output: <dir>/chunks/<table>.chunk-NNN.sql
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); const v = args[i + 1]; return i >= 0 && v !== undefined && !v.startsWith('--') ? v : d; };
const DIR = flag('--dir');
const TABLE = flag('--table', 'scooter_trips');
const ROWS = Number(flag('--rows', '70'));
if (!DIR) { console.error('Required: --dir <export-dir>'); process.exit(1); }
if (!Number.isFinite(ROWS) || ROWS <= 0) throw new Error('--rows must be a positive integer');

// Numeric columns to checksum per table (top-level typed fields in the enriched rows).
const NUMERIC_COLS = {
  scooter_trips: ['cost', 'distance_km', 'duration_minutes'],
  telemetry_events: ['battery_level'],
  spr_events: ['lat', 'lon'],
  spr_weather: [],
  revenue_days: ['total_paid_revenue', 'total_trips', 'unique_users_count', 'unique_vehicles_count'],
};

const srcFiles = readdirSync(DIR)
  .filter((f) => f.startsWith(`${TABLE}.`) && f.endsWith('.sql') && /\.\d+\.sql$/.test(f))
  .sort();
if (!srcFiles.length) { console.error(`No ${TABLE}.NNN.sql files in ${DIR}`); process.exit(1); }

let header = null;
let footer = null;
const rows = [];

for (const f of srcFiles) {
  const text = readFileSync(join(DIR, f), 'utf8');
  const lines = text.split('\n');
  const startIdx = lines.findIndex((l) => l.includes('$omni$['));
  const endIdx = lines.findIndex((l) => l.includes(']$omni$'));
  if (startIdx < 0 || endIdx < 0) { console.error(`! ${f}: markers not found`); process.exit(1); }
  const fileHeader = lines.slice(0, startIdx + 1).join('\n'); // up to & incl. "$omni$["
  const fileFooter = lines.slice(endIdx).join('\n');          // from "]$omni$" to end
  if (!header) {
    header = fileHeader;
    footer = fileFooter;
  } else {
    if (fileHeader !== header) {
      console.error(`! Header mismatch in ${f} vs ${srcFiles[0]}: aborting`);
      process.exit(1);
    }
    if (fileFooter !== footer) {
      console.error(`! Footer mismatch in ${f} vs ${srcFiles[0]}: aborting`);
      process.exit(1);
    }
  }
  for (let i = startIdx + 1; i < endIdx; i++) {
    const line = lines[i].trim().replace(/,+$/, '');
    if (line) rows.push(line);
  }
}

// Aggregate checksums from the parsed rows (integer-scaled to avoid float drift).
const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const sums = {};
for (const c of NUMERIC_COLS[TABLE] || []) sums[c] = 0;
const ids = new Set();
for (const line of rows) {
  const o = JSON.parse(line);
  ids.add(o.source_doc_id);
  for (const c of NUMERIC_COLS[TABLE] || []) sums[c] += Math.round(num(o[c]) * 1000);
}

const outDir = resolve(DIR, 'chunks');
mkdirSync(outDir, { recursive: true });
let nchunks = 0;
for (let i = 0; i < rows.length; i += ROWS) {
  const part = String(nchunks).padStart(3, '0');
  const body = rows.slice(i, i + ROWS).join(',\n');
  writeFileSync(join(outDir, `${TABLE}.chunk-${part}.sql`), `${header}\n${body}\n${footer}\n`);
  nchunks++;
}

console.log(`\nRe-chunked ${TABLE}: ${rows.length} rows → ${nchunks} chunk file(s) of ≤${ROWS} rows`);
console.log(`  out: ${outDir}`);
console.log(`  distinct source_doc_id: ${ids.size}`);
console.log('\n── VERIFY (run after loading, compare to these) ──');
console.log(`  expected count: ${rows.length}`);
for (const c of NUMERIC_COLS[TABLE] || []) {
  console.log(`  expected sum(${c})*1000 (rounded): ${sums[c]}`);
}
const colSql = (NUMERIC_COLS[TABLE] || []).map((c) => `round(sum(${c})*1000) as ${c}_x1000`).join(', ');
console.log('\n  Postgres check query:');
console.log(`    select count(*) as n, count(distinct source_doc_id) as distinct_ids${colSql ? ', ' + colSql : ''} from ${TABLE};`);
console.log('');
