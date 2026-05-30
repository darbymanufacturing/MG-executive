import { createContext, useContext, useCallback, useMemo } from 'react';
import { collection, doc, writeBatch, getDocs, query, where } from 'firebase/firestore';
import { db, auth } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';
import { classifyEventType } from '../utils/classifyEventType.js';
import { useOrg } from './OrgContext.jsx';
import { useOrgCollection } from '../hooks/useOrgCollection.js';

const EVENTS_COL = 'telemetryEvents';
const BATCH_SIZE = 450;
const MAX_EVENTS = 20000;

const TelemetryContext = createContext(null);

export function TelemetryProvider({ children }) {
  const { orgId } = useOrg();
  // Phase 2 (ADR-0003): org-scoped read. Kept route-scoped to /scooters + /pme.
  const { items, loading } = useOrgCollection(EVENTS_COL, { limit: MAX_EVENTS });

  // Re-classify each event on load (preserves the pre-Phase-2 `_type` field).
  const events = useMemo(
    () => items.map((d) => ({ ...d, _type: classifyEventType(d) })),
    [items],
  );

  const importEvents = useCallback(async (eventRows) => {
    if (!orgId) throw new Error('importEvents: no active org');
    const uid = auth.currentUser?.uid ?? null;
    for (let i = 0; i < eventRows.length; i += BATCH_SIZE) {
      const chunk = eventRows.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach((evt) => {
        const docId = `${evt.scooterId}_${evt.timestamp}_${evt.afterState || evt.eventType || ''}`
          .replace(/[/.#$[\]]/g, '_');
        const ref = doc(db, EVENTS_COL, docId);
        batch.set(ref, { ...evt, orgId, createdByUid: uid });
      });
      await safeWrite(
        () => batch.commit(),
        { rethrow: true, errorMessage: 'Telemetry import failed mid-batch' },
      );
    }
  }, [orgId]);

  const clearAllEvents = useCallback(async () => {
    if (!orgId) throw new Error('clearAllEvents: no active org');
    const snap = await getDocs(query(collection(db, EVENTS_COL), where('orgId', '==', orgId)));
    for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
      await safeWrite(
        () => batch.commit(),
        { rethrow: true, errorMessage: 'Failed to clear telemetry events' },
      );
    }
  }, [orgId]);

  const value = useMemo(() => ({
    events,
    loading,
    count: events.length,
    importEvents,
    clearAllEvents,
    hasData: events.length > 0,
  }), [events, loading, importEvents, clearAllEvents]);

  return (
    <TelemetryContext.Provider value={value}>
      {children}
    </TelemetryContext.Provider>
  );
}

export function useTelemetry() {
  return useContext(TelemetryContext);
}
