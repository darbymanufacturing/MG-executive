/**
 * useSupabaseTable — the read half of the Supabase time-series layer (ADR-0013).
 * A drop-in shape-match for `useOrgCollection`: same options
 * ({ orderBy, limit, where }) and the same return
 * ({ items, loading, error, loadMore, hasMore }), so the contexts that consume it
 * don't change their public API. Rows are mapped back to the EXACT Firestore shape
 * `{ _docId, ...data }` (the full original doc lives in the `data` jsonb column),
 * so downstream components are byte-for-byte unaffected.
 *
 * Org scoping is enforced server-side by RLS (org_id = auth.jwt()->>'orgId'); we
 * also add `.eq('org_id', …)` for defense-in-depth and keep useOrgCollection's
 * fail-loud invariant (throw if the org resolved but is absent).
 *
 * Unlike useOrgCollection this is fetch-on-change, not a live onSnapshot — these
 * five collections are bulk-imported analytical data, not multi-user live-edited
 * documents, so a re-fetch on mount / loadMore is the right cost/behaviour trade.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured, DATA_LAYER } from '../lib/supabase.js';
import { useOrg } from '../context/OrgContext.jsx';
import { useOrgCollection } from './useOrgCollection.js';

const DEFAULT_LIMIT = 50;

/** Firestore where-op → supabase-js filter method. */
export const OP_MAP = Object.freeze({
  '==': 'eq', '!=': 'neq', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte', in: 'in',
});

/**
 * Map one Supabase row to the Firestore-identical shape the app expects.
 * `data` jsonb is the complete original document (camelCase); `source_doc_id` is
 * the Firestore document id. Typed columns are SQL-only and intentionally dropped.
 */
export function mapRow(row) {
  if (!row) return null;
  return { _docId: row.source_doc_id, ...(row.data ?? {}) };
}

export function useSupabaseTable(table, opts = {}) {
  const { orgId, loading: orgLoading } = useOrg();
  const orderByOpt = opts.orderBy ?? null;
  const baseLimit = opts.limit ?? DEFAULT_LIMIT;
  const extraWhere = opts.where ?? [];
  const whereKey = JSON.stringify(extraWhere);
  const orderKey = JSON.stringify(orderByOpt);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pageLimit, setPageLimit] = useState(baseLimit);
  const [hasMore, setHasMore] = useState(false);

  // Fail loud (ADR-0003 parity): org resolved but absent → never query unscoped.
  if (!orgLoading && !orgId) {
    throw new Error(`useSupabaseTable('${table}') requires an orgId — none in context.`);
  }

  useEffect(() => {
    if (orgLoading || !orgId) { setLoading(true); return undefined; }
    if (!isSupabaseConfigured || !supabase) {
      setError(new Error('Supabase not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).'));
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        let q = supabase.from(table).select('*').eq('org_id', orgId);
        for (const c of extraWhere) {
          const method = OP_MAP[c[1]] ?? 'eq';
          q = q[method](c[0], c[2]);
        }
        if (orderByOpt) {
          const [f, dir] = Array.isArray(orderByOpt) ? orderByOpt : [orderByOpt, 'desc'];
          q = q.order(f, { ascending: dir === 'asc' });
        }
        q = q.range(0, pageLimit); // inclusive both ends → pageLimit+1 rows = hasMore sentinel
        const { data, error: qErr } = await q;
        if (cancelled) return;
        if (qErr) { setError(qErr); setLoading(false); return; }
        const rows = data ?? [];
        setHasMore(rows.length > pageLimit);
        setItems(rows.slice(0, pageLimit).map(mapRow));
        setLoading(false);
      } catch (err) {
        if (!cancelled) { setError(err); setLoading(false); }
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, orgId, orgLoading, orderKey, pageLimit, whereKey]);

  const loadMore = useCallback(() => setPageLimit((p) => p + baseLimit), [baseLimit]);

  return { items, loading, error, loadMore, hasMore };
}

/**
 * useOrgTable — picks the live data store by the build-time VITE_DATA_LAYER
 * constant. A context calls it once with both names + per-layer options and keeps
 * its external API identical regardless of which store is active.
 *
 *   const { items } = useOrgTable('revenue', 'revenue_days', {
 *     firestore: { orderBy: ['date', 'desc'], limit: 2000 },
 *     supabase:  { orderBy: ['revenue_date', 'desc'], limit: 2000 },
 *   });
 *
 * DATA_LAYER never changes at runtime (it's a build-time env value), so the branch
 * selects the SAME hook on every render — rules-of-hooks holds in practice even
 * though the linter can't prove the constant.
 */
export function useOrgTable(firestoreCollection, supabaseTable, perLayer = {}) {
  if (DATA_LAYER === 'supabase' && isSupabaseConfigured) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useSupabaseTable(supabaseTable, perLayer.supabase ?? {});
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useOrgCollection(firestoreCollection, perLayer.firestore ?? {});
}
