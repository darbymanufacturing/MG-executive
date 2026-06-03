/**
 * useOrgDoc — org-scoped single-document read (ADR-0003). Real-time (onSnapshot).
 * Returns `{ item, loading, error }`. The doc's `orgId` field is verified against
 * the active org after fetch, so a mis-targeted id can never surface another
 * org's document.
 *
 *   const { item, loading } = useOrgDoc('config', `${orgId}_fleet`);
 *
 * INVARIANT (ADR-0003): once the org has resolved but is absent (a user IS signed in),
 * it fails loud via an ERROR STATE (`error` set, no data) — never a synchronous throw
 * (#291). Mirrors the Supabase twin (useSupabaseDocLive).
 */
import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useOrg } from '../context/OrgContext.jsx';
import { layerFor } from '../lib/dataLayerConfig.js';
import { SUPABASE_TABLE } from '../lib/supabaseRowMap.js';
import { useSupabaseDocLive } from './useSupabaseLive.js';

/**
 * ADR-0015 seam: route to Supabase Realtime or Firestore per layerFor(collection).
 * `config`/`pow` both map to the app_config table; docId is the source_doc_id.
 */
export function useOrgDoc(collectionName, docId) {
  if (layerFor(collectionName) === 'supabase') {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useSupabaseDocLive(SUPABASE_TABLE[collectionName], docId);
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useFirestoreDoc(collectionName, docId);
}

function useFirestoreDoc(collectionName, docId) {
  const { orgId, loading: orgLoading, hasUser } = useOrg();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // #291: org resolved-but-absent (user signed in) fails loud via an ERROR STATE, never
  // a synchronous throw (a throw reached the outermost ErrorBoundary whose reset reloaded
  // the page). The hasUser guard preserves the #454 sign-in-race case (orgId=null,
  // hasUser=false -> stay loading). Mirrors useSupabaseDocLive.
  if (!orgLoading && !orgId && hasUser) {
    return {
      item: null, loading: false,
      error: new Error(`useOrgDoc('${collectionName}') requires an orgId — none in context.`),
    };
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset to loading when the doc target / org changes
    if (orgLoading || !orgId || !docId) { setLoading(true); return undefined; }
    // Pre-validate prefix (ADR-0003): refuse to subscribe to another org's doc.
    if (docId.includes('_') && !docId.startsWith(`${orgId}_`)) {
      setItem(null);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    setError(null);
    const unsub = onSnapshot(
      doc(db, collectionName, docId),
      (snap) => {
        if (!snap.exists()) { setItem(null); setLoading(false); return; }
        const data = snap.data();
        // Never surface another org's doc (defense-in-depth; rules are authoritative).
        if (data.orgId && data.orgId !== orgId) { setItem(null); setLoading(false); return; }
        setItem({ _docId: snap.id, ...data });
        setLoading(false);
      },
      (err) => { setError(err); setLoading(false); },
    );
    return unsub;
  }, [collectionName, docId, orgId, orgLoading]);

  return { item, loading, error };
}
