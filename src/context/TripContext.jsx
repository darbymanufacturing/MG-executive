import { createContext, useContext, useCallback, useMemo } from 'react';
import { collection, doc, writeBatch, getDocs, query, where } from 'firebase/firestore';
import { db, auth } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';
import { useOrg } from './OrgContext.jsx';
import { useOrgCollection } from '../hooks/useOrgCollection.js';

const TRIPS_COL = 'scooterTrips';
const BATCH_SIZE = 450;
const MAX_TRIPS = 10000;

export const TripContext = createContext(null);

export function TripProvider({ children }) {
  const { orgId } = useOrg();
  // Phase 2 (ADR-0003): org-scoped read. No orderBy (matches pre-Phase-2 behaviour).
  const { items: trips, loading } = useOrgCollection(TRIPS_COL, { limit: MAX_TRIPS });

  const importTrips = useCallback(async (tripRows) => {
    if (!orgId) throw new Error('importTrips: no active org');
    const uid = auth.currentUser?.uid ?? null;
    for (let i = 0; i < tripRows.length; i += BATCH_SIZE) {
      const chunk = tripRows.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach((trip) => {
        const docId = `${trip.scooterId}_${trip.startedAt}`.replace(/[/.#$[\]]/g, '_');
        const ref = doc(db, TRIPS_COL, docId);
        batch.set(ref, { ...trip, orgId, createdByUid: uid });
      });
      await safeWrite(
        () => batch.commit(),
        { rethrow: true, errorMessage: 'Trip import failed mid-batch' },
      );
    }
  }, [orgId]);

  const clearTripsForScooter = useCallback(async (scooterId) => {
    if (!orgId) throw new Error('clearTripsForScooter: no active org');
    // Two equality filters (orgId + scooterId) need no composite index.
    const q = query(
      collection(db, TRIPS_COL),
      where('orgId', '==', orgId),
      where('scooterId', '==', String(scooterId)),
    );
    const snap = await getDocs(q);
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await safeWrite(
      () => batch.commit(),
      { rethrow: true, errorMessage: 'Failed to clear trips' },
    );
  }, [orgId]);

  const value = useMemo(() => ({
    trips,
    loading,
    count: trips.length,
    importTrips,
    clearTripsForScooter,
  }), [trips, loading, importTrips, clearTripsForScooter]);

  return (
    <TripContext.Provider value={value}>
      {children}
    </TripContext.Provider>
  );
}

export function useTrips() {
  return useContext(TripContext);
}
