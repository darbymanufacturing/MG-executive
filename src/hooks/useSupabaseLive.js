/**
 * useSupabaseLive — the REALTIME read half of the ADR-0015 seam. Supabase twins of
 * useOrgCollection / useOrgDoc that subscribe to Postgres Changes (replacing
 * Firestore onSnapshot), so the operational collections stay live cross-user after
 * cutover. Return shapes match the Firestore hooks EXACTLY so the seam can delegate
 * with zero change to consuming contexts:
 *   useSupabaseCollectionLive(table, {where, orderBy, limit}) → { items, loading, error, loadMore, hasMore }
 *   useSupabaseDocLive(table, sourceDocId)                    → { item, loading, error }
 *
 * `where`/`orderBy` fields are the SNAKE_CASE Supabase columns (the seam translates
 * camelCase → column via SUPABASE_QUERY_MAP before calling). Rows are kept raw
 * internally (typed cols present via REPLICA IDENTITY FULL) so client-side ordering
 * by the DB column is correct; only the output is mapped to `{ _docId, ...data }`.
 *
 * Consistency note: this is best-effort live for a small-team ops tool — the initial
 * fetch then subscribe leaves a millisecond window, and a reconnect re-fetches to
 * resync. Merge-by-source_doc_id is idempotent, and the operational collections load
 * fully under their limits, so realtime is accurate in practice; a remount fully
 * reconciles. (Perfect cross-client consistency is not a requirement here.)
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase.js';
import { useOrg } from '../context/OrgContext.jsx';
import { mapRow, OP_MAP } from './useSupabaseTable.js';

const DEFAULT_LIMIT = 50;

/** Apply the (snake_case) extra where-clauses to a raw row client-side — the
 *  realtime stream only filters by org_id, so additional clauses run here. */
function matchesWhere(row, clauses) {
  for (const [field, op, val] of clauses) {
    const cell = row[field];
    switch (op) {
      case '==': if (cell !== val) return false; break;
      case '!=': if (cell === val) return false; break;
      case '>': if (!(cell > val)) return false; break;
      case '>=': if (!(cell >= val)) return false; break;
      case '<': if (!(cell < val)) return false; break;
      case '<=': if (!(cell <= val)) return false; break;
      case 'in': if (!Array.isArray(val) || !val.includes(cell)) return false; break;
      default: break;
    }
  }
  return true;
}

function makeComparator(field, dir) {
  if (!field) return null;
  const sign = dir === 'asc' ? 1 : -1;
  return (a, b) => {
    const av = a[field];
    const bv = b[field];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;          // nulls last
    if (bv == null) return -1;
    if (av < bv) return -1 * sign;
    if (av > bv) return 1 * sign;
    return 0;
  };
}

export function useSupabaseCollectionLive(table, opts = {}) {
  const { orgId, loading: orgLoading, hasUser } = useOrg();
  const orderByOpt = opts.orderBy ?? null;
  const baseLimit = opts.limit ?? DEFAULT_LIMIT;
  const extraWhere = opts.where ?? [];
  const whereKey = JSON.stringify(extraWhere);
  const orderKey = JSON.stringify(orderByOpt);

  const [rawItems, setRawItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pageLimit, setPageLimit] = useState(baseLimit);
  const [hasMore, setHasMore] = useState(false);

  // Fail loud (ADR-0003 parity): org resolved but absent → never query unscoped.
  if (!orgLoading && !orgId && hasUser) {
    throw new Error(`useSupabaseCollectionLive('${table}') requires an orgId — none in context.`);
  }

  const [orderField, orderDir] = Array.isArray(orderByOpt)
    ? orderByOpt
    : (orderByOpt ? [orderByOpt, 'desc'] : [null, 'desc']);

  useEffect(() => {
    if (orgLoading || !orgId) { setLoading(true); return undefined; }
    if (!isSupabaseConfigured || !supabase) {
      setError(new Error('Supabase not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).'));
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    let subscribedOnce = false;
    const cmp = makeComparator(orderField, orderDir);

    async function doFetch() {
      setLoading(true);
      let q = supabase.from(table).select('*').eq('org_id', orgId);
      for (const c of extraWhere) {
        const method = OP_MAP[c[1]] ?? 'eq';
        q = q[method](c[0], c[2]);
      }
      if (orderField) q = q.order(orderField, { ascending: orderDir === 'asc' });
      q = q.range(0, pageLimit); // +1 sentinel row → hasMore
      const { data, error: qErr } = await q;
      if (cancelled) return;
      if (qErr) { setError(qErr); setLoading(false); return; }
      const rows = data ?? [];
      setHasMore(rows.length > pageLimit);
      setRawItems(rows.slice(0, pageLimit));
      setError(null);
      setLoading(false);
    }

    doFetch();

    const channel = supabase
      .channel(`rt:${table}:${orgId}:${orderKey}:${whereKey}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, filter: `org_id=eq.${orgId}` }, (payload) => {
        if (cancelled) return;
        const newRow = payload.new;
        const oldRow = payload.old;
        if (newRow && newRow.org_id && newRow.org_id !== orgId) return; // defense-in-depth
        setRawItems((prev) => {
          if (payload.eventType === 'DELETE') {
            return prev.filter((r) => r.source_doc_id !== oldRow?.source_doc_id);
          }
          if (!newRow) return prev;
          // realtime stream only filters org_id — apply extra where-clauses here
          if (extraWhere.length && !matchesWhere(newRow, extraWhere)) {
            return prev.filter((r) => r.source_doc_id !== newRow.source_doc_id);
          }
          const i = prev.findIndex((r) => r.source_doc_id === newRow.source_doc_id);
          let next = i >= 0 ? prev.map((r, idx) => (idx === i ? newRow : r)) : [...prev, newRow];
          if (cmp) next = [...next].sort(cmp);
          return next.length > pageLimit ? next.slice(0, pageLimit) : next;
        });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (subscribedOnce && !cancelled) doFetch(); // reconnect → resync
          subscribedOnce = true;
        }
      });

    return () => { cancelled = true; supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, orgId, orgLoading, orderKey, whereKey, pageLimit]);

  const items = useMemo(() => rawItems.map(mapRow), [rawItems]);
  const loadMore = useCallback(() => setPageLimit((p) => p + baseLimit), [baseLimit]);

  return { items, loading, error, loadMore, hasMore };
}

export function useSupabaseDocLive(table, sourceDocId) {
  const { orgId, loading: orgLoading, hasUser } = useOrg();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  if (!orgLoading && !orgId && hasUser) {
    throw new Error(`useSupabaseDocLive('${table}') requires an orgId — none in context.`);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset to loading when the doc target / org changes
    if (orgLoading || !orgId || !sourceDocId) { setLoading(true); return undefined; }
    if (!isSupabaseConfigured || !supabase) {
      setError(new Error('Supabase not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).'));
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    let subscribedOnce = false;

    async function doFetch() {
      setLoading(true);
      const { data, error: qErr } = await supabase.from(table).select('*')
        .eq('org_id', orgId).eq('source_doc_id', sourceDocId).maybeSingle();
      if (cancelled) return;
      if (qErr) { setError(qErr); setLoading(false); return; }
      setItem(data ? mapRow(data) : null);
      setError(null);
      setLoading(false);
    }

    doFetch();

    const channel = supabase
      .channel(`rt:${table}:doc:${sourceDocId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, filter: `source_doc_id=eq.${sourceDocId}` }, (payload) => {
        if (cancelled) return;
        if (payload.eventType === 'DELETE') { setItem(null); return; }
        const row = payload.new;
        if (row && row.org_id && row.org_id !== orgId) return; // defense-in-depth
        setItem(row ? mapRow(row) : null);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (subscribedOnce && !cancelled) doFetch();
          subscribedOnce = true;
        }
      });

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [table, sourceDocId, orgId, orgLoading]);

  return { item, loading, error };
}
