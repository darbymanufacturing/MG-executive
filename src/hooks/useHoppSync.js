import { useState, useCallback, useEffect } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../lib/firebase.js';
import { useToast } from '../context/ToastContext.jsx';
import { friendlyFirestoreError } from '../utils/firestoreWrite.js';

/**
 * useHoppSync — drives the Refresh button in TopBar + the Hopp Sync section
 * in Settings. Two responsibilities:
 *
 *   1. `refresh()` triggers a manual sync by POSTing the user's Firebase ID
 *      token to `/api/cron-hopp-sync`. Shows a success/error toast with the
 *      sync counts.
 *   2. `lastSync` subscribes to the most recent `syncLogs` doc so the UI can
 *      show "Last synced: 7 min ago" without a separate fetch.
 *
 * Returns:
 *   refresh()       — async, throws nothing; toast handles failure
 *   syncing         — true while a refresh is in flight
 *   lastSync        — latest syncLogs doc or null
 *   recentSyncs     — last 10 syncLogs entries (for Settings panel)
 */
export default function useHoppSync() {
  const { success, error: errorToast } = useToast();
  const [syncing, setSyncing] = useState(false);
  const [recentSyncs, setRecentSyncs] = useState([]);
  const [lastSync, setLastSync] = useState(null);

  // Subscribe to the 10 most recent syncLogs entries
  useEffect(() => {
    const q = query(
      collection(db, 'syncLogs'),
      orderBy('finishedAt', 'desc'),
      limit(10),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setRecentSyncs(docs);
        setLastSync(docs[0] || null);
      },
      (err) => {
        // Don't toast on subscription errors — these are silent (likely first-run, no syncLogs yet)
        console.warn('[useHoppSync] syncLogs subscription error', err.message);
      },
    );
    return unsub;
  }, []);

  const refresh = useCallback(async () => {
    if (syncing) return;
    if (!auth.currentUser) {
      errorToast('You must be signed in to refresh');
      return;
    }
    setSyncing(true);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch('/api/cron-hopp-sync', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${idToken}` },
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok || !body.ok) {
        const msg = body.error
          || (body.errors && body.errors[0]?.error)
          || `Sync failed (${res.status})`;
        errorToast(`Sync failed: ${msg}`);
        return;
      }

      const w = body.written || {};
      const totalNew = (w.trips || 0) + (w.events || 0) + (w.tickets || 0);
      const errs = body.errors?.length || 0;
      const summary = totalNew > 0
        ? `Synced ${w.trips || 0} trips, ${w.events || 0} events, ${w.tickets || 0} tickets`
        : 'Up to date — nothing new from Hopp';
      success(errs > 0 ? `${summary} (${errs} per-scooter warnings)` : summary);
    } catch (err) {
      const friendly = friendlyFirestoreError(err);
      errorToast(`Sync failed: ${friendly}`);
    } finally {
      setSyncing(false);
    }
    // success/errorToast are stable from ToastContext
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncing]);

  return { refresh, syncing, lastSync, recentSyncs };
}
