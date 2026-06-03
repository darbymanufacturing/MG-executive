/**
 * Regression tests for BUG-442: rechunk-sql.mjs filename glob is fragile.
 *
 * Covers:
 *   1. With MANIFEST.json: rechunk reads exactly the files listed in the manifest.
 *   2. With MANIFEST.json + extra .sql not in manifest: warns to stderr, skips extra file.
 *   3. No MANIFEST.json fallback: regex glob picks up NNN.sql files, warns to stderr.
 *   4. No MANIFEST.json + malformed filename (.001.modified.sql): excluded by regex (current
 *      behavior preserved).
 *
 * Inlines the pure srcFiles derivation logic from rechunk-sql.mjs (< 20 lines) to run
 * in-process without spawning a child process or hitting Firebase/Supabase.
 *
 * Uses node:test (built-in) — runs via:
 *   node --test scripts/__tests__/rechunk-sql-manifest.test.mjs
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal valid .sql stub that rechunk-sql.mjs can parse (markers used
 * by the script to locate row boundaries).
 */
function buildSqlStub(rows = [{ source_doc_id: 'doc-1', cost: 1.5 }]) {
  const json = rows.map((r) => JSON.stringify(r)).join(',\n');
  return [
    'insert into scooter_trips (org_id, source_doc_id)',
    'select org_id, source_doc_id',
    'from jsonb_to_recordset($omni$[',
    json,
    ']$omni$::jsonb) as x(org_id text, source_doc_id text)',
    'on conflict (source_doc_id) do nothing;',
    '',
  ].join('\n');
}

/**
 * Build a minimal MANIFEST.json payload.
 */
function buildManifest({ exportedAt = '2026-01-01T00-00-00-000Z', orgId = 'test-org', files }) {
  return JSON.stringify({ exportedAt, orgId, files }, null, 2);
}

/**
 * Inline reproduction of the srcFiles derivation logic introduced in rechunk-sql.mjs
 * to fix BUG-442. Tests this pure logic in isolation without spawning a child process.
 *
 * @param {string} dir    - directory to scan
 * @param {string} table  - table name prefix (e.g. 'scooter_trips')
 * @returns {{ srcFiles: string[], warnings: string[] }}
 */
function srcFilesLogic(dir, table) {
  const warnings = [];
  const manifestPath = join(dir, 'MANIFEST.json');
  let srcFiles;
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    srcFiles = manifest.files
      .filter((e) => e.table === table)
      .map((e) => e.filename)
      .sort();
    const allSql = readdirSync(dir).filter((f) => f.startsWith(`${table}.`) && f.endsWith('.sql'));
    const extra = allSql.filter((f) => !srcFiles.includes(f));
    if (extra.length) {
      warnings.push(`! WARNING: ${extra.length} ${table}.*.sql file(s) found in dir NOT in MANIFEST — skipped: ${extra.join(', ')}`);
    }
  } else {
    warnings.push(`! No MANIFEST.json in ${dir} — relying on filename pattern /\\.\\d+\\.sql$/. Re-export to get a manifest.`);
    srcFiles = readdirSync(dir)
      .filter((f) => f.startsWith(`${table}.`) && f.endsWith('.sql') && /\.\d+\.sql$/.test(f))
      .sort();
  }
  return { srcFiles, warnings };
}

const TABLE = 'scooter_trips';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('#BUG-442 — rechunk-sql.mjs MANIFEST.json-based file selection', () => {
  let tmpDir;

  before(() => {
    tmpDir = join(tmpdir(), `rechunk-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads exactly the two files listed in MANIFEST.json', () => {
    const dir = join(tmpDir, 'test-manifest-exact');
    mkdirSync(dir, { recursive: true });

    writeFileSync(join(dir, `${TABLE}.000.sql`), buildSqlStub([{ source_doc_id: 'a' }]));
    writeFileSync(join(dir, `${TABLE}.001.sql`), buildSqlStub([{ source_doc_id: 'b' }]));

    writeFileSync(
      join(dir, 'MANIFEST.json'),
      buildManifest({
        files: [
          { filename: `${TABLE}.000.sql`, table: TABLE, rows: 1 },
          { filename: `${TABLE}.001.sql`, table: TABLE, rows: 1 },
        ],
      }),
    );

    const { srcFiles, warnings } = srcFilesLogic(dir, TABLE);

    assert.deepEqual(srcFiles, [`${TABLE}.000.sql`, `${TABLE}.001.sql`]);
    assert.equal(warnings.length, 0, 'no warnings expected when all files are in manifest');
  });

  it('warns and skips extra .sql files NOT listed in MANIFEST.json', () => {
    const dir = join(tmpDir, 'test-manifest-extra');
    mkdirSync(dir, { recursive: true });

    writeFileSync(join(dir, `${TABLE}.000.sql`), buildSqlStub([{ source_doc_id: 'a' }]));
    writeFileSync(join(dir, `${TABLE}.001.sql`), buildSqlStub([{ source_doc_id: 'b' }]));
    // Third file NOT in manifest (hand-edited variant)
    writeFileSync(join(dir, `${TABLE}.001.modified.sql`), buildSqlStub([{ source_doc_id: 'c' }]));

    writeFileSync(
      join(dir, 'MANIFEST.json'),
      buildManifest({
        files: [
          { filename: `${TABLE}.000.sql`, table: TABLE, rows: 1 },
          { filename: `${TABLE}.001.sql`, table: TABLE, rows: 1 },
        ],
      }),
    );

    const { srcFiles, warnings } = srcFilesLogic(dir, TABLE);

    assert.deepEqual(srcFiles, [`${TABLE}.000.sql`, `${TABLE}.001.sql`]);
    assert.equal(warnings.length, 1, 'one warning for extra file not in manifest');
    assert.ok(warnings[0].includes('WARNING'), 'warning message must include WARNING');
    assert.ok(
      warnings[0].includes(`${TABLE}.001.modified.sql`),
      'warning must name the skipped file',
    );
  });

  it('falls back to regex glob when no MANIFEST.json is present, and emits a console.warn', () => {
    const dir = join(tmpDir, 'test-no-manifest');
    mkdirSync(dir, { recursive: true });

    writeFileSync(join(dir, `${TABLE}.000.sql`), buildSqlStub([{ source_doc_id: 'a' }]));
    writeFileSync(join(dir, `${TABLE}.001.sql`), buildSqlStub([{ source_doc_id: 'b' }]));
    // No MANIFEST.json

    const { srcFiles, warnings } = srcFilesLogic(dir, TABLE);

    assert.deepEqual(srcFiles, [`${TABLE}.000.sql`, `${TABLE}.001.sql`]);
    assert.equal(warnings.length, 1, 'one warning about missing manifest');
    assert.ok(warnings[0].includes('No MANIFEST.json'), 'warning must mention missing MANIFEST.json');
  });

  it('no-manifest path: .001.modified.sql is excluded by the /\\.\\d+\\.sql$/ regex (behavior preserved)', () => {
    const dir = join(tmpDir, 'test-no-manifest-malformed');
    mkdirSync(dir, { recursive: true });

    writeFileSync(join(dir, `${TABLE}.000.sql`), buildSqlStub([{ source_doc_id: 'a' }]));
    writeFileSync(join(dir, `${TABLE}.001.sql`), buildSqlStub([{ source_doc_id: 'b' }]));
    // Malformed filename — final segment before .sql is "001.modified", not all digits
    writeFileSync(join(dir, `${TABLE}.001.modified.sql`), buildSqlStub([{ source_doc_id: 'c' }]));
    // No MANIFEST.json

    const { srcFiles } = srcFilesLogic(dir, TABLE);

    assert.deepEqual(srcFiles, [`${TABLE}.000.sql`, `${TABLE}.001.sql`]);
    assert.ok(
      !srcFiles.includes(`${TABLE}.001.modified.sql`),
      'malformed filename must be excluded by the regex fallback',
    );
  });
});
