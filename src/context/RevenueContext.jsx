import { createContext, useContext, useCallback, useMemo } from 'react';
import {
  collection, doc, writeBatch, getDocs, query, where,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';
import { useOrg } from './OrgContext.jsx';
import { useOrgTable } from '../hooks/useSupabaseTable.js';
import { dualWriteSupabase } from '../lib/supabase.js';
import { orgDelete } from '../hooks/orgWrite.js';
import { orgDocId } from '../utils/orgDocId.js';

const REVENUE_COL = 'revenue';
const SB_TABLE    = 'revenue_days';
const BATCH_SIZE  = 450; // Firestore batch limit is 500; stay safe
// Hard cap on revenue snapshot — Phase 1 free-tier defense. 2000 daily rows ≈ 5 years per city.
const MAX_REVENUE_ROWS = 2000;

const RevenueContext = createContext(null);

export function RevenueProvider({ children }) {
  const { orgId } = useOrg();

  // ── Org-scoped listener (ADR-0003); ADR-0013: Firestore OR Supabase per flag ──
  const { items, loading: revenueLoading, error } = useOrgTable(REVENUE_COL, SB_TABLE, {
    firestore: { orderBy: ['date', 'desc'], limit: MAX_REVENUE_ROWS },
    supabase: { orderBy: ['revenue_date', 'desc'], limit: MAX_REVENUE_ROWS },
  });

  // Preserve the public shape: consumers read `_docId`. Client re-sort keeps
  // same-date rows stable (matches the pre-Phase-2 behaviour).
  const revenueData = useMemo(
    () => [...items].sort((a, b) => (a.date < b.date ? 1 : -1)),
    [items],
  );

  // ── Import (batch, chunked, date-as-doc-ID for dedup) ────────────────────
  const importRevenueDays = useCallback(async (days) => {
    if (!orgId) throw new Error('importRevenueDays: no active org');
    const uid = auth.currentUser?.uid ?? null;
    const sbEntries = [];
    for (let i = 0; i < days.length; i += BATCH_SIZE) {
      const chunk = days.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach((day) => {
        // Org-prefixed deterministic id (ADR-0002): every org has the same dates,
        // so the date alone would collide across orgs.
        const docId = orgDocId(orgId, day.date, day.location || 'global');
        batch.set(doc(db, REVENUE_COL, docId), { ...day, orgId, createdByUid: uid }); // setDoc via batch → overwrites
        sbEntries.push({ id: docId, data: { ...day, orgId, createdByUid: uid } });
      });
      await safeWrite(
        () => batch.commit(),
        { rethrow: true, errorMessage: 'Revenue import failed mid-batch' },
      );
    }
    // ADR-0013: mirror to Supabase (best-effort; never blocks the Firestore write).
    await dualWriteSupabase(REVENUE_COL, orgId, sbEntries);
  }, [orgId]);

  // ── Delete a single day ───────────────────────────────────────────────────
  const deleteRevenueDay = useCallback(async (docId) => {
    await orgDelete(REVENUE_COL, docId, { rethrow: true, errorMessage: 'Failed to delete revenue entry' });
  }, []);

  // ── Clear all revenue data (THIS org only) ────────────────────────────────
  const clearAllRevenue = useCallback(async () => {
    if (!orgId) throw new Error('clearAllRevenue: no active org');
    const snap = await getDocs(query(collection(db, REVENUE_COL), where('orgId', '==', orgId)));
    for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
      await safeWrite(
        () => batch.commit(),
        { rethrow: true, errorMessage: 'Failed to clear revenue data' },
      );
    }
  }, [orgId]);

  // BUG #301 — memoize the context value to prevent unnecessary Firestore reconnects
  const value = useMemo(() => ({
    revenueData,
    revenueLoading,
    snapshotError: error ? error.message : null,
    importRevenueDays,
    deleteRevenueDay,
    clearAllRevenue,
  }), [revenueData, revenueLoading, error, importRevenueDays, deleteRevenueDay, clearAllRevenue]);

  return (
    <RevenueContext.Provider value={value}>
      {children}
    </RevenueContext.Provider>
  );
}

export function useRevenue() {
  const ctx = useContext(RevenueContext);
  if (!ctx) throw new Error('useRevenue must be used inside <RevenueProvider>');
  return ctx;
}
