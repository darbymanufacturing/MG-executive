import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  collection, doc, onSnapshot,
  writeBatch, setDoc, deleteDoc, getDocs, query, orderBy, limit,
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';
import { useAuth } from './AuthContext.jsx';

const REVENUE_COL = 'revenue';
const BATCH_SIZE  = 450; // Firestore batch limit is 500; stay safe
// Hard cap on revenue snapshot — Phase 1 free-tier defense. 2000 daily rows ≈ 5 years per city.
const MAX_REVENUE_ROWS = 2000;

const RevenueContext = createContext(null);

export function RevenueProvider({ children }) {
  const { user } = useAuth();
  const [revenueData, setRevenueData]     = useState([]);
  const [revenueLoading, setRevenueLoading] = useState(true);

  // ── Real-time listener ────────────────────────────────────────────────────

  useEffect(() => {
    // Reset state when user changes (e.g. different user signs in)
    setRevenueData([]);
    setRevenueLoading(true);

    // orderBy 'date' desc + limit — Firestore enforces the cap server-side so big collections
    // don't blow the free-tier read quota. Client still sorts to handle any same-date rows.
    const q = query(
      collection(db, REVENUE_COL),
      orderBy('date', 'desc'),
      limit(MAX_REVENUE_ROWS),
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs
        .map((d) => ({ _docId: d.id, ...d.data() }))
        .sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
      setRevenueData(rows);
      setRevenueLoading(false);
    });
    return unsub;
  }, [user]);

  // ── Import (batch, chunked, date-as-doc-ID for dedup) ────────────────────

  const importRevenueDays = useCallback(async (days) => {
    // Chunk into groups of BATCH_SIZE
    for (let i = 0; i < days.length; i += BATCH_SIZE) {
      const chunk = days.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach((day) => {
        const rawId = `${day.date}_${day.location || 'global'}`;
        const docId = rawId.replace(/[\/\.#$[\]]/g, '_');
        const ref = doc(db, REVENUE_COL, docId);
        batch.set(ref, day); // setDoc via batch → overwrites existing doc
      });
      await safeWrite(
        () => batch.commit(),
        { rethrow: true, errorMessage: 'Revenue import failed mid-batch' },
      );
    }
  }, []);

  // ── Delete a single day ───────────────────────────────────────────────────

  const deleteRevenueDay = useCallback(async (docId) => {
    await safeWrite(
      () => deleteDoc(doc(db, REVENUE_COL, docId)),
      { rethrow: true, errorMessage: 'Failed to delete revenue entry' },
    );
  }, []);

  // ── Clear all revenue data ────────────────────────────────────────────────

  const clearAllRevenue = useCallback(async () => {
    const snap = await getDocs(collection(db, REVENUE_COL));
    for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
      await safeWrite(
        () => batch.commit(),
        { rethrow: true, errorMessage: 'Failed to clear revenue data' },
      );
    }
  }, []);

  return (
    <RevenueContext.Provider
      value={{
        revenueData,
        revenueLoading,
        importRevenueDays,
        deleteRevenueDay,
        clearAllRevenue,
      }}
    >
      {children}
    </RevenueContext.Provider>
  );
}

export function useRevenue() {
  const ctx = useContext(RevenueContext);
  if (!ctx) throw new Error('useRevenue must be used inside <RevenueProvider>');
  return ctx;
}
