/**
 * TripContext.jsx
 * Manages the org-scoped `scooterTrips` collection (Phase 2 / ADR-0003).
 * DocId pattern: `${scooterId}_${startedAt}` (idempotent re-upload).
 */

import { createContext, useContext, useCallback, useMemo } from 'react';
import { collection, doc, writeBatch, getDocs, query, where, serverTimestamp } from 'firebase/firestore';
import * as Sentry from '@sentry/react';
import { db, auth } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';
import { useOrg } from './OrgContext.jsx';
import { useFleet } from './FleetContext.jsx';
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
  const { fleetForCity } = useFleet();
  // ADR-0013: reads Firestore OR Supabase per VITE_DATA_LAYER (default firestore).
  const { items: trips, loading } = useOrgTable(TRIPS_COL, SB_TABLE, {
    firestore: { limit: MAX_TRIPS },
    // #478 — order the Supabase read (Postgres needs no index for this); the Firestore
    // side stays orderless to avoid requiring a new (orgId, startedAt) composite index.
    supabase: { limit: MAX_TRIPS, orderBy: ['started_at', 'desc'] },
  });

  /**
   * Batch-upsert trip rows from parseTripLogCsv output. Returns { written }.
   *
   * @param {object[]} rows  - output of parseTripLogCsv()
   * @param {string}  [city] - optional city for the scooter these trips belong to.
   *   The trip CSV has no city column; the caller (TripImporter) knows the scooter
   *   and should pass the scooter's city so fleetId can be stamped. When omitted
   *   the trips are stored without fleetId (scopeByFleet treats them as unassigned).
   *   #559 — canonical fleet key; existing city/location fields are not removed.
   */
  const importTrips = useCallback(async (rows, city) => {
    if (!orgId) throw new Error('importTrips: no active org');
    const uid = auth.currentUser?.uid ?? null;
    // #559 — resolve fleetId once (all rows share the same scooter/city).
    const fleet = city ? fleetForCity(city) : null;
    const fleetId = fleet?._docId ?? null;
    const fleetPatch = fleetId ? { fleetId } : {};
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
          { ...row, orgId, createdByUid: uid, _importedAt: serverTimestamp(), ...fleetPatch },
          { merge: true },
        );
        // #480 — include _importedAt as an ISO string so the Supabase row matches the
        // Firestore field; serverTimestamp() sentinels are not serialisable to JSON.
        sbEntries.push({ id: docId, data: { ...row, orgId, createdByUid: uid, _importedAt: new Date().toISOString(), ...fleetPatch } });
        written++;
      });
      await safeWrite(
        () => batch.commit(),
        { rethrow: true, errorMessage: 'Trip import failed mid-batch' },
      );
    }
    // ADR-0013: mirror to Supabase — #481 fire-and-forget (Firestore is authoritative).
    // #494 — inspect the result and emit a Sentry warning when chunks fail so parity
    // drift is visible in the error dashboard before the next nightly parity-check cron.
    void dualWriteSupabase(TRIPS_COL, orgId, sbEntries)
      .then(({ failed, failedChunks } = {}) => {
        if (failed > 0) {
          Sentry.captureMessage(`[trips dual-write] ${failed} rows failed in chunks: ${failedChunks?.join(', ')}`, {
            level: 'warning',
            extra: { orgId, failedChunks, collection: TRIPS_COL },
          });
        }
      })
      .catch((e) => console.warn('[supabase dual-write] late failure:', e?.message ?? e));
    return { written };
  }, [orgId, fleetForCity]);

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
