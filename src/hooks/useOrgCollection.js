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
 * INVARIANT (ADR-0003): throws synchronously once the org has resolved but is
 * absent — a forgotten org context fails loud, never silently returns unscoped or
 * empty data. While the org is still resolving it returns `loading: true`.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  collection, query, where, orderBy as fbOrderBy, limit as fbLimit, onSnapshot,
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useOrg } from '../context/OrgContext.jsx';

const DEFAULT_LIMIT = 50;

export function useOrgCollection(collectionName, opts = {}) {
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

  // Fail loud (ADR-0003): org resolved but absent → never query unscoped.
  // Guard with hasUser: during the transient sign-in race where userProfile hasn't
  // populated yet (orgId=null, hasUser=false), suppress the throw and stay loading
  // (bug #454). Only throw when a real user is signed in but has no orgId.
  if (!orgLoading && !orgId && hasUser) {
    throw new Error(`useOrgCollection('${collectionName}') requires an orgId — none in context.`);
  }

  useEffect(() => {
    if (orgLoading || !orgId) { setLoading(true); return undefined; }
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
        setHasMore(docs.length > pageLimit);
        setItems(docs.slice(0, pageLimit));
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
