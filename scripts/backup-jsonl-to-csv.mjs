#!/usr/bin/env node
/**
 * backup-jsonl-to-csv.mjs — derive human-portable CSV files from a completed
 * Firestore JSONL backup (the output of backup-firestore.mjs). LOCAL ONLY:
 * no Firestore, no Supabase, no network, zero quota cost.
 *
 * Kostas asked for "a simple CSV of current data we can re-upload after the
 * migration" as a safety net. The .jsonl backup is the LOSSLESS primary (keep it);
 * these CSVs are the convenience/inspection copy. Nested objects/arrays are written
 * as compact JSON strings in their cell (so the CSV is still round-trippable by a
 * controlled parser, and readable in a spreadsheet).
 *
 *   node scripts/backup-jsonl-to-csv.mjs --dir backups/firestore-YYYYMMDD-HHMMSS
 *   node scripts/backup-jsonl-to-csv.mjs --dir <backup-dir> --only pow_tasks,maintenanceTickets
 *
 * Output: <backup-dir>/csv/<collection>.csv  (header row = union of all keys seen)
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); const v = args[i + 1]; return i >= 0 && v !== undefined && !v.startsWith('--') ? v : d; };
const DIR = flag('--dir');
const ONLY = (flag('--only') || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!DIR) { console.error('Required: --dir <backup-dir>'); process.exit(1); }

const dir = resolve(DIR);
const outDir = join(dir, 'csv');
mkdirSync(outDir, { recursive: true });

// Decode the backup's Firestore-sentinel encoding back to plain values for the CSV.
function decode(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'object' && v.__fs === 'ts') return new Date(v.seconds * 1000 + Math.round((v.nanoseconds || 0) / 1e6)).toISOString();
  if (typeof v === 'object' && v.__fs === 'geo') return `${v.latitude},${v.longitude}`;
  if (typeof v === 'object' && v.__fs === 'ref') return v.path;
  if (Array.isArray(v)) return v.map(decode);
  if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = decode(v[k]); return o; }
  return v;
}

// One CSV cell: primitives as-is; objects/arrays as compact JSON; CSV-escape.
function cell(v) {
  if (v === null || v === undefined) return '';
  const s = (typeof v === 'object') ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.jsonl'))
  .filter((f) => !ONLY.length || ONLY.includes(f.replace(/\.jsonl$/, '')))
  .sort();

if (!files.length) { console.error(`No .jsonl files in ${dir}`); process.exit(1); }

console.log(`\nJSONL → CSV  (${dir})\n`);
let grand = 0;
for (const f of files) {
  const coll = f.replace(/\.jsonl$/, '');
  const lines = readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean);
  const rows = lines.map((l) => { const o = JSON.parse(l); return { _id: o.id, ...decode(o.data) }; });
  // Header = union of all keys across all rows (docs are heterogeneous).
  const keys = ['_id'];
  for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  const csv = [keys.join(','), ...rows.map((r) => keys.map((k) => cell(r[k])).join(','))].join('\n') + '\n';
  writeFileSync(join(outDir, `${coll}.csv`), csv);
  grand += rows.length;
  console.log(`  ${coll.padEnd(26)} ${String(rows.length).padStart(6)} rows · ${keys.length} cols`);
}
console.log(`\n✓ ${grand} rows across ${files.length} collections → ${outDir}`);
console.log('  (the .jsonl backup remains the lossless primary; these CSVs are the portable copy)\n');
