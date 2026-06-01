/**
 * TripContext.jsx
 * Manages the org-scoped `scooterTrips` collection (Phase 2 / ADR-0003).
 * DocId pattern: `${scooterId}_${startedAt}` (idempotent re-upload).
 */

import { createContext, useContext, useCallback, useMemo } from 'react';
import { collection, doc, writeBatch, getDocs, query, where, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';
import { useOrg } from './OrgContext.jsx';
import { useOrgTable } from '../hooks/useSupabaseTable.js';
import { dualWriteSupabase, dualClearSupabase } from '../lib/supabase.js';
import { orgDocId } from '../utils/orgDocId.js';

const TRIPS_COL  = 'scooterTrips';
const SB_TABLE   = 'scooter_trips';
const BATCH_SIZE = 450;
const MAX_TRIPS  = 10000;

const TripContext = createContext(null);

export function TripProvider({ children }) {
  const { orgId } = useOrg();
  // ADR-0013: reads Firestore OR Supabase per VITE_DATA_LAYER (default firestore).
  const { items: trips, loading } = useOrgTable(TRIPS_COL, SB_TABLE, {
    firestore: { limit: MAX_TRIPS },
    // #478 — order the Supabase read (Postgres needs no index for this); the Firestore
    // side stays orderless to avoid requiring a new (orgId, startedAt) composite index.
    supabase: { limit: MAX_TRIPS, orderBy: ['started_at', 'desc'] },
  });

  /** Batch-upsert trip rows from parseTripLogCsv output. Returns { written }. */
  const importTrips = useCallback(async (rows) => {
    if (!orgId) throw new Error('importTrips: no active org');
    const uid = auth.currentUser?.uid ?? null;
    let written = 0;
    const sbEntries = [];
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      rows.slice(i, i + BATCH_SIZE).forEach((row) => {
        // #115 — normalise startedAt to a Firestore-safe id fragment.
        const safeStartedAt = row.startedAt instanceof Date
          ? row.startedAt.toISOString()
          : typeof row.startedAt === 'string'
            ? row.startedAt
            : String(row.startedAt ?? '');
        // Org-prefix the deterministic id (ADR-0002). row._docId is the parser's
        // un-prefixed fingerprint; prefix it (or the built scooterId_startedAt id).
        const baseId = row._docId || (row.scooterId + '_' + safeStartedAt.replace(/[^0-9TZ]/g, '').slice(0, 19));
        const docId = orgDocId(orgId, baseId);
        batch.set(
          doc(db, TRIPS_COL, docId),
          { ...row, orgId, createdByUid: uid, _importedAt: serverTimestamp() },
          { merge: true },
        );
        sbEntries.push({ id: docId, data: { ...row, orgId, createdByUid: uid } });
        written++;
      });
      await safeWrite(
        () => batch.commit(),
        { rethrow: true, errorMessage: 'Trip import failed mid-batch' },
      );
    }
    // ADR-0013: mirror to Supabase — #481 fire-and-forget (Firestore is authoritative).
    void dualWriteSupabase(TRIPS_COL, orgId, sbEntries)
      .catch((e) => console.warn('[supabase dual-write] late failure:', e?.message ?? e));
    return { written };
  }, [orgId]);

  /* NOTE: trips are queried/deleted by the scooterId FIELD (+ orgId), never by doc id,
     so the doc-id prefixing above is transparent to clearTripsForScooter below. */
  /** Delete all trips for a specific scooter (so re-import is clean). Returns count. */
  const clearTripsForScooter = useCallback(async (scooterId) => {
    if (!orgId) throw new Error('clearTripsForScooter: no active org');
    // Two equality filters (orgId + scooterId) → no composite index required.
    const q = query(
      collection(db, TRIPS_COL),
      where('orgId', '==', orgId),
      where('scooterId', '==', String(scooterId)),
    );
    const snap = await getDocs(q);
    for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
      await safeWrite(
        () => batch.commit(),
        { rethrow: true, errorMessage: 'Failed to clear trips for scooter' },
      );
    }
    // #479 — mirror the per-scooter clear to Supabase (scooter_id typed column).
    await dualClearSupabase(TRIPS_COL, orgId, [['scooter_id', '==', String(scooterId)]]);
    return snap.docs.length;
  }, [orgId]);

  const value = useMemo(
    () => ({ trips, loading, count: trips.length, importTrips, clearTripsForScooter }),
    [trips, loading, importTrips, clearTripsForScooter],
  );

  return (
    <TripContext.Provider value={value}>
      {children}
    </TripContext.Provider>
  );
}

export function useTrips() {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error('useTrips must be used inside TripProvider');
  return ctx;
}
