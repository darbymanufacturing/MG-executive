/**
 * useOrgDoc — org-scoped single-document read (ADR-0003). Real-time (onSnapshot).
 * Returns `{ item, loading, error }`. The doc's `orgId` field is verified against
 * the active org after fetch, so a mis-targeted id can never surface another
 * org's document.
 *
 *   const { item, loading } = useOrgDoc('config', `${orgId}_fleet`);
 *
 * INVARIANT (ADR-0003): throws once the org has resolved but is absent.
 */
import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useOrg } from '../context/OrgContext.jsx';

export function useOrgDoc(collectionName, docId) {
  const { orgId, loading: orgLoading, hasUser } = useOrg();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fail loud (ADR-0003): org resolved but absent.
  // Guard with hasUser: during the transient sign-in race where userProfile hasn't
  // populated yet (orgId=null, hasUser=false), suppress the throw and stay loading
  // (bug #454). Only throw when a real user is signed in but has no orgId.
  if (!orgLoading && !orgId && hasUser) {
    throw new Error(`useOrgDoc('${collectionName}') requires an orgId — none in context.`);
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
