import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  collection, doc, onSnapshot,
  writeBatch, setDoc, deleteDoc, getDocs,
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';

const REVENUE_COL = 'revenue';
const BATCH_SIZE  = 450; // Firestore batch limit is 500; stay safe

const RevenueContext = createContext(null);

export function RevenueProvider({ children }) {
  const [revenueData, setRevenueData]     = useState([]);
  const [revenueLoading, setRevenueLoading] = useState(true);

  // ── Real-time listener ────────────────────────────────────────────────────

  useEffect(() => {
    const unsub = onSnapshot(collection(db, REVENUE_COL), (snap) => {
      const rows = snap.docs
        .map((d) => ({ _docId: d.id, ...d.data() }))
        .sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
      setRevenueData(rows);
      setRevenueLoading(false);
    });
    return unsub;
  }, []);

  // ── Import (batch, chunked, date-as-doc-ID for dedup) ────────────────────

  const importRevenueDays = useCallback(async (days) => {
    // Chunk into groups of BATCH_SIZE
    for (let i = 0; i < days.length; i += BATCH_SIZE) {
      const chunk = days.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach((day) => {
        const docId = `${day.date}_${day.location || 'global'}`;
        const ref = doc(db, REVENUE_COL, docId);
        batch.set(ref, day); // setDoc via batch → overwrites existing doc
      });
      await batch.commit();
    }
  }, []);

  // ── Delete a single day ───────────────────────────────────────────────────

  const deleteRevenueDay = useCallback(async (docId) => {
    await deleteDoc(doc(db, REVENUE_COL, docId));
  }, []);

  // ── Clear all revenue data ────────────────────────────────────────────────

  const clearAllRevenue = useCallback(async () => {
    const snap = await getDocs(collection(db, REVENUE_COL));
    for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
      await batch.commit();
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
