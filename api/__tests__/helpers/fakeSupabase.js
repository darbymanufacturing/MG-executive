/**
 * A tiny in-memory stand-in for the supabase-js query builder, covering exactly
 * the chains the Autopilot server code uses:
 *   from(t).select(..).eq(..)[.eq|.like](..)            → await → { data: rows }
 *   from(t).select(..).eq(..).maybeSingle()              → { data: row | null }
 *   from(t).upsert(row | rows, { onConflict })           → upsert by source_doc_id
 *   from(t).update(patch).eq(..)[.eq(..)]                → shallow-set columns on matches
 *
 * `tables` is { tableName: [{ org_id, source_doc_id, data, ... }] } and is
 * mutated in place, so a test can assert on what was written.
 */
const likeToRegExp = (pattern) => new RegExp(
  `^${String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`,
);

export function fakeSupabase(tables = {}) {
  const from = (table) => {
    const filters = [];
    let op = 'select';
    let payload = null;

    const matches = () => (tables[table] || []).filter((row) => filters.every(([col, test]) => test(row[col])));

    const run = () => {
      if (op === 'update') {
        for (const row of matches()) Object.assign(row, payload);
        return { data: null, error: null };
      }
      return { data: matches(), error: null };
    };

    const builder = {
      select() { op = 'select'; return builder; },
      eq(col, val) { filters.push([col, (v) => v === val]); return builder; },
      like(col, pattern) { const re = likeToRegExp(pattern); filters.push([col, (v) => re.test(String(v))]); return builder; },
      update(patch) { op = 'update'; payload = patch; return builder; },
      async upsert(input) {
        const list = Array.isArray(input) ? input : [input];
        tables[table] = tables[table] || [];
        for (const row of list) {
          const i = tables[table].findIndex((x) => x.source_doc_id === row.source_doc_id);
          if (i >= 0) tables[table][i] = { ...row }; else tables[table].push({ ...row });
        }
        return { error: null };
      },
      async maybeSingle() { return { data: matches()[0] || null, error: null }; },
      then(resolve, reject) { try { resolve(run()); } catch (err) { reject?.(err); } },
    };
    return builder;
  };
  return { from, tables };
}

/** Row helper: { org_id, source_doc_id, data }. */
export const row = (orgId, sdid, data) => ({ org_id: orgId, source_doc_id: sdid, data });

/** The `data` of a stored row, or undefined. */
export const docOf = (tables, table, sdid) => (tables[table] || []).find((r) => r.source_doc_id === sdid)?.data;
