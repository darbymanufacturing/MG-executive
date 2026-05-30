/**
 * TelemetryContext.jsx
 * Manages the org-scoped `telemetryEvents` collection (Phase 2 / ADR-0003).
 *
 * Design: "store raw, derive on demand". Events are never pre-aggregated.
 * Fingerprint-based dedup: each event's docId = `${scooterId}_${timestamp}_${afterState}`
 * so re-uploading the same CSV writes 0 new docs.
 */

import { createContext, useContext, useCallback, useMemo } from 'react';
import { collection, doc, writeBatch, getDocs, query, where, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../lib/firebase.js';
import { classifyEventType } from '../utils/classifyEventType.js';
import { safeWrite } from '../utils/firestoreWrite.js';
import { useOrg } from './OrgContext.jsx';
import { useOrgCollection } from '../hooks/useOrgCollection.js';
import { orgDocId } from '../utils/orgDocId.js';

const EVENTS_COL = 'telemetryEvents';
const BATCH_SIZE = 450;
const MAX_EVENTS = 20000;

const TelemetryContext = createContext(null);

export function TelemetryProvider({ children }) {
  const { orgId } = useOrg();
  // Phase 2 (ADR-0003): org-scoped read. Kept route-scoped to /scooters + /pme.
  const { items, loading } = useOrgCollection(EVENTS_COL, { limit: MAX_EVENTS });

  // Re-classify on load so data ingested under older classifier rules picks up the
  // latest logic without re-upload. Preserves the `_docId` + `eventType` shape.
  const events = useMemo(
    () => items.map((data) => ({
      ...data,
      eventType: classifyEventType(data.beforeState, data.afterState, data.reason),
    })),
    [items],
  );

  /**
   * Idempotent batch import. Returns { written, duplicates }.
   * @param {object[]} parsedEvents - output of parseStatusLogCsv().events (each has _docId)
   * @param {function} onProgress   - optional (pct 0-100) => void
   */
  const importEvents = useCallback(async (parsedEvents, onProgress) => {
    if (!parsedEvents.length) return { written: 0, duplicates: 0 };
    if (!orgId) throw new Error('importEvents: no active org');
    const uid = auth.currentUser?.uid ?? null;

    // Dedup must compare like-for-like: stored events carry the ORG-PREFIXED doc id
    // (`_docId` from useOrgCollection), while the parser emits the RAW fingerprint.
    // Prefix the parser's id before comparing + writing so re-uploads still dedup.
    const existingIds = new Set(events.map((e) => e._docId));
    const newRows = parsedEvents.filter((e) => !existingIds.has(orgDocId(orgId, e._docId)));
    const duplicates = parsedEvents.length - newRows.length;

    let written = 0;
    const total = newRows.length;
    for (let i = 0; i < total; i += BATCH_SIZE) {
      const chunk = newRows.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach((ev) => {
        const { _docId, ...data } = ev;
        // Org-prefix the parser's fingerprint id (ADR-0002): future non-Hopp imports
        // can't assume globally-unique scooter ids, so prefix unconditionally.
        const ref = doc(db, EVENTS_COL, orgDocId(orgId, _docId));
        batch.set(ref, { ...data, orgId, createdByUid: uid, createdAt: serverTimestamp() });
      });
      await safeWrite(
        () => batch.commit(),
        { rethrow: true, errorMessage: 'Telemetry import failed mid-batch' },
      );
      written += chunk.length;
      if (onProgress) onProgress(Math.round((written / total) * 100));
    }
    return { written, duplicates };
  }, [events, orgId]);

  const clearAllEvents = useCallback(async () => {
    if (!orgId) throw new Error('clearAllEvents: no active org');
    const allDocs = await getDocs(query(collection(db, EVENTS_COL), where('orgId', '==', orgId)));
    for (let i = 0; i < allDocs.docs.length; i += BATCH_SIZE) {
      const chunk = allDocs.docs.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach((d) => batch.delete(d.ref));
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
  const ctx = useContext(TelemetryContext);
  if (!ctx) throw new Error('useTelemetry must be used inside <TelemetryProvider>');
  return ctx;
}
