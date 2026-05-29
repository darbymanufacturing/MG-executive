/**
 * TripContext.jsx
 * Manages the `scooterTrips` Firestore collection.
 *
 * SCAFFOLD — trip import CSV schema is TBD. This context loads all trips into
 * memory and exposes importTrips() for batch upsert via CSV.
 *
 * DocId pattern: `${scooterId}_${startedAt}` (idempotent — re-uploading same CSV
 * is safe).
 *
 * Collection will remain empty until the user imports a trip CSV.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  collection, onSnapshot, writeBatch, doc, serverTimestamp, query, where, getDocs, deleteDoc, limit,
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';

const TRIPS_COL  = 'scooterTrips';
const BATCH_SIZE = 450;
const MAX_TRIPS  = 10000;

const TripContext = createContext(null);

export function TripProvider({ children }) {
  const [trips,   setTrips]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [count,   setCount]   = useState(0);

  // Real-time listener
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, TRIPS_COL), limit(MAX_TRIPS)),
      (snap) => {
        setTrips(snap.docs.map((d) => ({ _docId: d.id, ...d.data() })));
        setCount(snap.size);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, []);

  /**
   * Batch-upsert trip rows from parseTripLogCsv output.
   * Returns { written, skipped } counts.
   */
  const importTrips = useCallback(async (rows) => {
    let written = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      rows.slice(i, i + BATCH_SIZE).forEach((row) => {
        // #115 — Date objects produce strings with spaces/parens (invalid Firestore IDs).
        // Normalise startedAt to an ISO string, then strip all non-alphanumeric chars.
        const safeStartedAt = row.startedAt instanceof Date
          ? row.startedAt.toISOString()
          : typeof row.startedAt === 'string'
            ? row.startedAt
            : String(row.startedAt ?? '');
        const docId = row._docId || (row.scooterId + '_' + safeStartedAt.replace(/[^0-9TZ]/g, '').slice(0, 19));
        batch.set(
          doc(db, TRIPS_COL, docId),
          { ...row, _importedAt: serverTimestamp() },
          { merge: true },
        );
        written++;
      });
      await safeWrite(
        () => batch.commit(),
        { rethrow: true, errorMessage: 'Trip import failed mid-batch' },
      );
    }
    return { written };
  }, []);

  /**
   * Delete all trips for a specific scooter (so re-import is clean).
   */
  const clearTripsForScooter = useCallback(async (scooterId) => {
    const q    = query(collection(db, TRIPS_COL), where('scooterId', '==', String(scooterId)));
    const snap = await getDocs(q);
    for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
      await safeWrite(
        () => batch.commit(),
        { rethrow: true, errorMessage: 'Failed to clear trips for scooter' },
      );
    }
    return snap.docs.length;
  }, []);

  return (
    <TripContext.Provider value={{ trips, loading, count, importTrips, clearTripsForScooter }}>
      {children}
    </TripContext.Provider>
  );
}

export function useTrips() {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error('useTrips must be used inside TripProvider');
  return ctx;
}
