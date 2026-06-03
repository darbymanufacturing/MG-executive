/**
 * scripts/rechunk-sql.test.mjs
 *
 * Tests for rechunk-sql.mjs header/footer mismatch detection (BUG #417).
 * Writes minimal .NNN.sql fixture files to a temp dir, invokes rechunk-sql.mjs
 * as a child process via spawnSync, and asserts exit code + stderr.
 *
 * Run: npx vitest run scripts/rechunk-sql.test.mjs
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT = resolve(__filename, '../rechunk-sql.mjs');
const TABLE = 'scooter_trips';

// ---------------------------------------------------------------------------
// Helper: build a minimal valid .sql file matching rechunk-sql.mjs's expected
// format: INSERT header, $omni$[ ... ]$omni$ markers, ON CONFLICT footer.
// Each row is a JSON line between the markers.
// ---------------------------------------------------------------------------
function buildSqlFile(rows, { columnList = 'org_id text, source_doc_id text, cost numeric' } = {}) {
  const header = `insert into ${TABLE} (org_id, source_doc_id, cost)\nselect org_id, source_doc_id, cost\nfrom jsonb_to_recordset($omni$[`;
  const footer = `]$omni$::jsonb) as x(${columnList})\non conflict (source_doc_id) do nothing;`;
  const body = rows.map((r) => JSON.stringify(r)).join(',\n');
  return `${header}\n${body}\n${footer}\n`;
}

function spawnRechunk(dir) {
  return spawnSync(process.execPath, [SCRIPT, '--dir', dir, '--table', TABLE, '--rows', '2'], {
    encoding: 'utf8',
  });
}

describe('rechunk-sql — header/footer mismatch detection (BUG #417)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `rechunk-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  // -------------------------------------------------------------------------
  // Mismatch case: two source files with subtly different headers (column order
  // swapped). rechunk-sql.mjs must exit non-zero and print "mismatch".
  // -------------------------------------------------------------------------
  it('exits non-zero and prints "mismatch" when source file headers differ', () => {
    const row1 = { org_id: 'org1', source_doc_id: 'trip001', cost: 5.5 };
    const row2 = { org_id: 'org1', source_doc_id: 'trip002', cost: 6.0 };

    // File 000: normal header
    writeFileSync(
      join(tmpDir, `${TABLE}.000.sql`),
      buildSqlFile([row1], { columnList: 'org_id text, source_doc_id text, cost numeric' }),
    );
    // File 001: different header (column order swapped → different AS-clause string)
    writeFileSync(
      join(tmpDir, `${TABLE}.001.sql`),
      buildSqlFile([row2], { columnList: 'source_doc_id text, org_id text, cost numeric' }),
    );

    const result = spawnRechunk(tmpDir);

    expect(result.status).not.toBe(0);
    expect((result.stderr + result.stdout).toLowerCase()).toMatch(/mismatch/);
  });

  // -------------------------------------------------------------------------
  // Passing case: two source files with identical headers. Should exit 0 and
  // produce chunk files in <dir>/chunks/.
  // -------------------------------------------------------------------------
  it('exits 0 and produces chunk files when all source files have identical headers', () => {
    const rows = [
      { org_id: 'org1', source_doc_id: 'trip001', cost: 5.5 },
      { org_id: 'org1', source_doc_id: 'trip002', cost: 6.0 },
      { org_id: 'org1', source_doc_id: 'trip003', cost: 7.0 },
    ];

    const _sqlContent = buildSqlFile(rows, { columnList: 'org_id text, source_doc_id text, cost numeric' });

    // Both files have exactly the same header and footer; only row data differs.
    writeFileSync(join(tmpDir, `${TABLE}.000.sql`), buildSqlFile(rows.slice(0, 2)));
    writeFileSync(join(tmpDir, `${TABLE}.001.sql`), buildSqlFile(rows.slice(2)));

    const result = spawnRechunk(tmpDir);

    expect(result.status).toBe(0);

    // Verify chunk output directory was created and has at least one chunk file.
    const chunksDir = join(tmpDir, 'chunks');
    const chunkFiles = readdirSync(chunksDir).filter((f) => f.startsWith(`${TABLE}.chunk-`));
    expect(chunkFiles.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Footer mismatch case: same header but different ON CONFLICT clause.
  // Must also be detected as a mismatch.
  // -------------------------------------------------------------------------
  it('exits non-zero and prints "mismatch" when source file footers differ', () => {
    const row1 = { org_id: 'org1', source_doc_id: 'trip001', cost: 5.5 };
    const row2 = { org_id: 'org1', source_doc_id: 'trip002', cost: 6.0 };

    // File 000: normal (uses helper default footer)
    writeFileSync(join(tmpDir, `${TABLE}.000.sql`), buildSqlFile([row1]));

    // File 001: manually built with a different ON CONFLICT clause in footer
    const header = `insert into ${TABLE} (org_id, source_doc_id, cost)\nselect org_id, source_doc_id, cost\nfrom jsonb_to_recordset($omni$[`;
    const altFooter = `]$omni$::jsonb) as x(org_id text, source_doc_id text, cost numeric)\non conflict (source_doc_id) do update set cost = excluded.cost;`;
    writeFileSync(
      join(tmpDir, `${TABLE}.001.sql`),
      `${header}\n${JSON.stringify(row2)}\n${altFooter}\n`,
    );

    const result = spawnRechunk(tmpDir);

    expect(result.status).not.toBe(0);
    expect((result.stderr + result.stdout).toLowerCase()).toMatch(/mismatch/);
  });
});

// ---------------------------------------------------------------------------
// BUG #438 — per-line JSON parse guard
// ---------------------------------------------------------------------------
describe('rechunk-sql — per-line JSON parse guard (BUG #438)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `rechunk-test-438-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  // -------------------------------------------------------------------------
  // HAPPY PATH — each body line is valid JSON. Should exit 0 and produce chunks.
  // -------------------------------------------------------------------------
  it('exits 0 when all body lines are valid one-JSON-per-line rows', () => {
    const rows = [
      { org_id: 'org1', source_doc_id: 'trip001', cost: 5.5 },
      { org_id: 'org1', source_doc_id: 'trip002', cost: 6.0 },
      { org_id: 'org1', source_doc_id: 'trip003', cost: 7.0 },
    ];
    writeFileSync(join(tmpDir, `${TABLE}.000.sql`), buildSqlFile(rows));

    const result = spawnRechunk(tmpDir);

    expect(result.status).toBe(0);
    const chunksDir = join(tmpDir, 'chunks');
    const chunkFiles = readdirSync(chunksDir).filter((f) => f.startsWith(`${TABLE}.chunk-`));
    expect(chunkFiles.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // BAD FORMAT PATH — a body line contains a multi-line pretty-printed fragment
  // (not valid JSON on its own after comma-strip). Must exit 1 and print
  // "not valid JSON" to stderr.
  // -------------------------------------------------------------------------
  it('exits 1 and prints "not valid JSON" when a body line is not complete JSON', () => {
    // Inject a line that is only the opening brace of a pretty-printed object —
    // it will not parse on its own.
    const header = `insert into ${TABLE} (org_id, source_doc_id, cost)\nselect org_id, source_doc_id, cost\nfrom jsonb_to_recordset($omni$[`;
    const footer = `]$omni$::jsonb) as x(org_id text, source_doc_id text, cost numeric)\non conflict (source_doc_id) do nothing;`;
    // Deliberately broken: first line of a pretty-printed JSON object
    const badBody = `{\n  "org_id": "org1",`;
    writeFileSync(join(tmpDir, `${TABLE}.000.sql`), `${header}\n${badBody}\n${footer}\n`);

    const result = spawnRechunk(tmpDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/not valid JSON/);
  });
});
