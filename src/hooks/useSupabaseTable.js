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
 *
 * Pagination design (bug-385 fix):
 *   State holds a `fetchSpec` object: { filterKey, offset }. loadMore increments
 *   offset by baseLimit; a filter change resets offset to 0 — both happen in a
 *   single setState call so React only ever schedules ONE effect run per logical
 *   action, preventing the double-fetch that occurred with separate state values.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured, DATA_LAYER } from '../lib/supabase.js';
import { useOrg } from '../context/OrgContext.jsx';
import { useOrgCollection } from './useOrgCollection.js';
import { useToast } from '../context/ToastContext.jsx';
import * as Sentry from '@sentry/react';

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
  if (row.data == null) return null;  // null-data row is not a valid doc — drop it
  return { _docId: row.source_doc_id, ...row.data };
}

export function useSupabaseTable(table, opts = {}) {
  const { orgId, loading: orgLoading, hasUser } = useOrg();
  const { error: toastError } = useToast();
  const orderByOpt = opts.orderBy ?? null;
  const baseLimit = opts.limit ?? DEFAULT_LIMIT;
  const extraWhere = opts.where ?? [];
  const whereKey = JSON.stringify(extraWhere);
  const orderKey = JSON.stringify(orderByOpt);

  // A single state object bundles the filter identity and the pagination offset.
  // Updating both together in one setState ensures a single effect run, preventing
  // the double-fetch that arose from two separate state updates (bug-385).
  const filterKey = `${table}:${orgId}:${orderKey}:${whereKey}`;
  const [fetchSpec, setFetchSpec] = useState({ filterKey, offset: 0 });

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);

  // #523/#291: org resolved-but-absent (user IS signed in) fails loud via an ERROR
  // STATE — never a synchronous throw (a throw reached the outermost ErrorBoundary
  // whose reset reloaded the page, tearing down every listener and crashing
  // RevenueContext). The `hasUser` guard keeps the auth-race window (orgId=null,
  // hasUser=false) in a loading state. Mirrors useOrgCollection / useSupabaseCollectionLive.
  if (!orgLoading && !orgId && hasUser) {
    return {
      items: [], loading: false,
      error: new Error(`useSupabaseTable('${table}') requires an orgId — none in context.`),
      loadMore: () => {}, hasMore: false,
    };
  }

  // When the filter/table changes, reset offset to 0 and clear items in a single
  // state update — this guarantees only ONE effect run for a filter change.
  useEffect(() => {
    setFetchSpec((prev) => {
      if (prev.filterKey === filterKey) return prev; // loadMore path — no reset needed
      return { filterKey, offset: 0 };
    });
    // #490 — do NOT clear items here; keep the stale page visible until the new fetch
    // lands (matches Firestore onSnapshot UX — no flash of empty state on filter change).
    // The `loading` flag drives any overlay; offset===0 below replaces the items.
  }, [filterKey]);

  useEffect(() => {
    if (orgLoading || !orgId) { setLoading(true); return undefined; }
    if (!isSupabaseConfigured || !supabase) {
      const cfgErr = new Error('Supabase not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
      setError(cfgErr);
      setLoading(false);
      toastError('Supabase not configured — check VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.');
      return undefined;
    }
    // If the fetchSpec's filterKey doesn't match the current filter, a reset is in
    // flight — skip this stale fetch; the reset effect will update fetchSpec and
    // trigger this effect again with the correct (reset) offset.
    if (fetchSpec.filterKey !== filterKey) { return undefined; }

    const { offset } = fetchSpec;
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
        // Fetch only the new page: range(offset, offset + baseLimit) inclusive.
        // The extra row (baseLimit+1 total) is the hasMore sentinel.
        q = q.range(offset, offset + baseLimit);
        const { data, error: qErr } = await q;
        if (cancelled) return;
        if (qErr) {
          setError(qErr);
          setLoading(false);
          toastError(qErr.message || 'Failed to load data from Supabase.');
          Sentry.captureException(qErr, { extra: { table, orgId, offset, opts } });
          return;
        }
        const rows = data ?? [];
        setHasMore(rows.length > baseLimit);
        const pageRows = rows.slice(0, baseLimit).map(mapRow).filter(Boolean);
        if (offset === 0) {
          // Initial load or filter reset: replace items.
          setItems(pageRows);
        } else {
          // loadMore: append new page to existing items.
          setItems((prev) => [...prev, ...pageRows]);
        }
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err);
          setLoading(false);
          toastError(err.message || 'Unexpected error loading data.');
          Sentry.captureException(err, { extra: { table, orgId, offset, opts } });
        }
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchSpec, orgLoading]);

  const loadMore = useCallback(
    () => setFetchSpec((prev) => ({ ...prev, offset: prev.offset + baseLimit })),
    [baseLimit]
  );

  // #387 — expose a refresh callback so callers (e.g. RevenueContext after a write)
  // can force a re-fetch without a full navigation cycle. Resetting to offset:0 with
  // the current filterKey re-runs the fetch effect and replaces items from scratch.
  const refresh = useCallback(
    () => setFetchSpec({ filterKey, offset: 0 }),
    [filterKey]
  );

  return { items, loading, error, loadMore, hasMore, refresh };
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
 * Rules-of-hooks compliance: `useDataLayerHook` is the single adapter reference
 * resolved at module load time. Because DATA_LAYER is a build-time Vite constant
 * in production, the branch never changes after module evaluation, so every
 * render of useOrgTable always calls exactly one hook (useDataLayerHook) — the
 * hook-call count is stable across renders and the rules-of-hooks invariant holds.
 *
 * In Vitest the module mock returns DATA_LAYER via a getter, so the lazy
 * initialisation below defers the getter read until after mock setup completes.
 */

// Resolved lazily on first useOrgTable call (not at module parse time) so that
// Vitest mock getters are fully wired before DATA_LAYER is first read.
// Exported for testing only — do NOT reassign in application code.
export const _useOrgTableAdapterCache = { fn: null };

export function useOrgTable(firestoreCollection, supabaseTable, perLayer = {}) {
  // #482 — when DATA_LAYER=supabase but credentials are absent, a synchronous throw
  // here crashed every page that uses a Supabase-backed context into the ErrorBoundary.
  // Instead: log loudly and fall back to Firestore so the app stays usable without a
  // redeploy. The _useOrgTableAdapterCache is forced to useOrgCollection for this
  // module lifetime (or until the cache is reset in tests).
  if (DATA_LAYER === 'supabase' && !isSupabaseConfigured) {
    if (!_useOrgTableAdapterCache.fn) {
      // One-time warning — subsequent renders reuse the cached fn and stay silent.
      console.error(
        '[useOrgTable] VITE_DATA_LAYER=supabase but Supabase is not configured. ' +
        'Set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY, or set VITE_DATA_LAYER=firestore. ' +
        'Falling back to Firestore for this session.'
      );
    }
    // Force the adapter to Firestore so rules-of-hooks are still satisfied: the
    // same hook (useOrgCollection) will be called on every subsequent render.
    _useOrgTableAdapterCache.fn = useOrgCollection;
    return useOrgCollection(firestoreCollection, perLayer.firestore ?? {});
  }

  // Populate the adapter once per module lifetime (or per test file when reset
  // via _useOrgTableAdapterCache.fn = null in beforeEach). After the first call
  // the same hook reference is used on every render — rules-of-hooks hold.
  if (!_useOrgTableAdapterCache.fn) {
    _useOrgTableAdapterCache.fn = DATA_LAYER === 'supabase' ? useSupabaseTable : useOrgCollection;
  }
  const col = DATA_LAYER === 'supabase' ? supabaseTable : firestoreCollection;
  const opts = DATA_LAYER === 'supabase' ? (perLayer.supabase ?? {}) : (perLayer.firestore ?? {});
  const result = _useOrgTableAdapterCache.fn(col, opts);
  // #387 — forward the `refresh` callback that useSupabaseTable now exposes.
  // useOrgCollection doesn't have one (Firestore onSnapshot self-updates), so we
  // provide a no-op to keep the return shape stable for callers.
  return { refresh: () => {}, ...result };
}
