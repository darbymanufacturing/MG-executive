/**
 * useOrgCollection — the leak-proof READ half of the ADR-0003 org-scoped data
 * layer. ALWAYS injects `where('orgId','==',orgId)`, paginates by default
 * (limit 50 + loadMore), and is real-time (onSnapshot, matching the app's idiom).
 *
 *   const { items, loading, error, loadMore, hasMore } = useOrgCollection('costs', {
 *     orderBy: 'createdAt',            // field | [field, 'asc'|'desc'] (default 'desc')
 *     limit: 50,                        // default 50
 *     where: [['active', '==', true]], // extra clauses, ANDed with the orgId filter
 *   });
 *
 * INVARIANT (ADR-0003): once the org has resolved but is absent (a user IS signed in),
 * it fails loud via an ERROR STATE — `error` is set and no data is returned — but does
 * NOT throw (#291: a synchronous throw reached the outermost ErrorBoundary, whose reset
 * reloaded the page and tore down every listener). Matches the Supabase twin. While the
 * org is still resolving it returns `loading: true`.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  collection, query, where, orderBy as fbOrderBy, limit as fbLimit, onSnapshot,
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useOrg } from '../context/OrgContext.jsx';
import { layerFor } from '../lib/dataLayerConfig.js';
import { SUPABASE_TABLE, SUPABASE_QUERY_MAP } from '../lib/supabaseRowMap.js';
import { useSupabaseCollectionLive } from './useSupabaseLive.js';

const DEFAULT_LIMIT = 50;

/** Translate a Firestore-style {where,orderBy,limit} to the snake_case Supabase
 *  columns (ADR-0015). Only fields with a SUPABASE_QUERY_MAP entry are remapped. */
function toSupabaseOpts(collectionName, opts) {
  const map = SUPABASE_QUERY_MAP[collectionName] ?? {};
  const tr = (f) => map[f] ?? f;
  const out = {};
  if (opts.limit != null) out.limit = opts.limit;
  if (opts.orderBy) {
    const [f, dir] = Array.isArray(opts.orderBy) ? opts.orderBy : [opts.orderBy, 'desc'];
    out.orderBy = [tr(f), dir];
  }
  if (opts.where) out.where = opts.where.map(([f, op, v]) => [tr(f), op, v]);
  return out;
}

/**
 * ADR-0015 seam: route to Supabase Realtime or Firestore per layerFor(collection).
 * layerFor() is a build-time constant for a given collection, so the same branch is
 * taken on every render — rules-of-hooks holds in practice (the same waiver
 * useOrgTable relies on). The Firestore path below is unchanged.
 */
export function useOrgCollection(collectionName, opts = {}) {
  if (layerFor(collectionName) === 'supabase') {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useSupabaseCollectionLive(SUPABASE_TABLE[collectionName], toSupabaseOpts(collectionName, opts));
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useFirestoreCollection(collectionName, opts);
}

function useFirestoreCollection(collectionName, opts = {}) {
  const { orgId, loading: orgLoading, hasUser } = useOrg();
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

  // #303: retain the last known items across re-subscriptions so that during the
  // loading window (loading:true, new onSnapshot not yet fired) the UI shows stale
  // counts rather than zero. A ref is used to avoid triggering renders.
  const lastKnownItemsRef = useRef([]);
  // #303 multi-tenant guard: the retained items belong to ONE org. Track which, so an
  // org switch never flashes the prior tenant's data under the new orgId — on mismatch
  // we drop to [] (the new org loads from empty, as before this cache existed).
  const lastKnownOrgRef = useRef(null);

  // #291: org resolved-but-absent (user signed in) fails loud via an ERROR STATE — never
  // a synchronous throw (a throw reached the outermost ErrorBoundary whose reset reloaded
  // the page, tearing down every listener). Mirrors useSupabaseCollectionLive.
  if (!orgLoading && !orgId && hasUser) {
    return {
      items: [], loading: false,
      error: new Error(`useOrgCollection('${collectionName}') requires an orgId — none in context.`),
      loadMore: () => {}, hasMore: false,
    };
  }

  useEffect(() => {
    // The missing-org case returned an error state above, so here we only handle:
    // still loading, or orgId present.
    if (orgLoading || !orgId) { setLoading(true); return undefined; }
    // #303: seed items with last known value so chip counts stay non-zero during
    // the re-subscription window (before the new onSnapshot fires) — but ONLY if the
    // cached items belong to the current org (multi-tenant guard).
    if (lastKnownOrgRef.current !== orgId) { lastKnownItemsRef.current = []; lastKnownOrgRef.current = orgId; }
    setItems(lastKnownItemsRef.current);
    setLoading(true);
    setError(null);

    const clauses = [
      where('orgId', '==', orgId),
      ...extraWhere.map((c) => where(c[0], c[1], c[2])),
    ];
    let q = query(collection(db, collectionName), ...clauses);
    if (orderByOpt) {
      const [f, dir] = Array.isArray(orderByOpt) ? orderByOpt : [orderByOpt, 'desc'];
      q = query(q, fbOrderBy(f, dir));
    }
    q = query(q, fbLimit(pageLimit + 1)); // +1 sentinel to detect hasMore

    const unsub = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs.map((d) => ({ _docId: d.id, ...d.data() }));
        const page = docs.slice(0, pageLimit);
        lastKnownItemsRef.current = page; // #303: keep ref in sync for next re-subscription
        lastKnownOrgRef.current = orgId; // #303: tag the cache with its owning org
        setHasMore(docs.length > pageLimit);
        setItems(page);
        setLoading(false);
      },
      (err) => { setError(err); setLoading(false); },
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionName, orgId, orgLoading, orderKey, pageLimit, whereKey]);

  const loadMore = useCallback(() => setPageLimit((p) => p + baseLimit), [baseLimit]);

  return { items, loading, error, loadMore, hasMore };
}
