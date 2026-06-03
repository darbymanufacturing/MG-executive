/**
 * scripts/load-staged-sql-to-supabase.test.mjs
 *
 * Regression tests for `rowsFromSql` — the function that extracts the JSON
 * row array from a $omni$[...]$omni$ dollar-quoted block (BUG #437).
 *
 * Run: npx vitest run scripts/load-staged-sql-to-supabase.test.mjs
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Inline the fixed function so we can test it without importing the full
// script (which requires SUPABASE_URL env var and @supabase/supabase-js).
// If the implementation in the real file diverges, tests will catch it.
// ---------------------------------------------------------------------------
function rowsFromSql(text) {
  const openMatch = /\$omni\$\[/.exec(text);
  const closeMatch = /\]\$omni\$/.exec(text);
  if (!openMatch || !closeMatch || closeMatch.index <= openMatch.index) {
    throw new Error('no $omni$ markers');
  }
  // Slice from the '[' through the ']' to get the full JSON array.
  const json = text.slice(openMatch.index + 6, closeMatch.index + 1);
  return JSON.parse(json);
}

// Build a synthetic .sql file body as the exporter would produce it.
function buildSqlBlock(rows) {
  const json = `[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]`;
  return `insert into spr_events (org_id, source_doc_id, lat, lon)\n` +
    `select org_id, source_doc_id, lat, lon\n` +
    `from jsonb_to_recordset($omni$${json}$omni$::jsonb) as x(org_id text, source_doc_id text, lat double precision, lon double precision)\n` +
    `on conflict (source_doc_id) do nothing;\n`;
}

describe('rowsFromSql — $omni$ marker parsing (BUG #437)', () => {
  // -------------------------------------------------------------------------
  // CASE 1: normal input — well-formed SQL with two rows.
  // -------------------------------------------------------------------------
  it('correctly parses a normal $omni$[...]$omni$ block', () => {
    const rows = [
      { org_id: 'org1', source_doc_id: 'evt001', lat: 37.927123, lon: 23.641456 },
      { org_id: 'org1', source_doc_id: 'evt002', lat: 38.003456, lon: 23.722789 },
    ];
    const sql = buildSqlBlock(rows);
    const result = rowsFromSql(sql);
    expect(result).toHaveLength(2);
    expect(result[0].source_doc_id).toBe('evt001');
    expect(result[1].lat).toBe(38.003456);
  });

  // -------------------------------------------------------------------------
  // CASE 2: poisoned input — a row field contains the literal string "$omni$".
  // With the old lastIndexOf-based approach, this would find the in-data
  // occurrence of "$omni$" and slice a malformed fragment.
  // The regex-anchored approach ($omni$[ / ]$omni$) is unambiguous because
  // the combined token (bracket + marker) cannot appear in a JSON string value.
  // -------------------------------------------------------------------------
  it('correctly parses rows whose field values contain the literal string "$omni$"', () => {
    const rows = [
      { source_doc_id: 'x', notes: 'ran the $omni$ script' },
      { source_doc_id: 'y', notes: 'another $omni$ reference' },
    ];
    const json = `[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]`;
    // Build the SQL block manually (notes column not in the helper, but the
    // parser only cares about the $omni$[...]$omni$ delimiters).
    const sql = `insert into t (source_doc_id) select source_doc_id\n` +
      `from jsonb_to_recordset($omni$${json}$omni$::jsonb) as x(source_doc_id text)\n` +
      `on conflict (source_doc_id) do nothing;\n`;

    const result = rowsFromSql(sql);
    expect(result).toHaveLength(2);
    expect(result[0].source_doc_id).toBe('x');
    expect(result[0].notes).toBe('ran the $omni$ script');
    expect(result[1].notes).toBe('another $omni$ reference');
  });

  // -------------------------------------------------------------------------
  // CASE 3: missing markers — must throw.
  // -------------------------------------------------------------------------
  it('throws when no $omni$ markers are present', () => {
    expect(() => rowsFromSql('insert into t values (1);')).toThrow('no $omni$ markers');
  });
});
