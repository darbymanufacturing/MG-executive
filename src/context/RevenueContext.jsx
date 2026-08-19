import { createContext, useContext, useCallback, useMemo } from 'react';
import {
  collection, doc, writeBatch, getDocs, query, where, limit,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';
import { useOrg } from './OrgContext.jsx';
import { useFleet } from './FleetContext.jsx';
import { useOrgTable } from '../hooks/useSupabaseTable.js';
import { dualWriteSupabase, dualDeleteSupabase, dualClearSupabase } from '../lib/supabase.js';
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
  const { fleetForCity } = useFleet();

  // ── Org-scoped listener (ADR-0003); ADR-0013: Firestore OR Supabase per flag ──
  // #387 — destructure `refresh` so writes can force a re-fetch when DATA_LAYER=supabase.
  const { items, loading: revenueLoading, error, refresh: refreshRevenue } = useOrgTable(REVENUE_COL, SB_TABLE, {
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
        // #559 — stamp fleetId (canonical fleet key) alongside the existing city/location
        // field. fleetForCity returns null when no fleet covers the city (e.g. before
        // fleets are configured); omit the field rather than writing null, so scopeByFleet
        // treats the doc as "unassigned" and includes it in every fleet view.
        const cityKey = day.location || day.city || null;
        const fleet = cityKey ? fleetForCity(cityKey) : null;
        const fleetId = fleet?._docId ?? null;
        const docData = { ...day, orgId, createdByUid: uid, ...(fleetId ? { fleetId } : {}) };
        batch.set(doc(db, REVENUE_COL, docId), docData); // setDoc via batch → overwrites
        sbEntries.push({ id: docId, data: docData });
      });
      await safeWrite(
        () => batch.commit(),
        { rethrow: true, errorMessage: 'Revenue import failed mid-batch' },
      );
    }
    // ADR-0013: mirror to Supabase — #481 Firestore is authoritative; await so that
    // refreshRevenue() reads after the write resolves (#621). The .catch() swallows
    // Supabase errors so a dual-write failure never blocks the Firestore-authoritative import.
    await dualWriteSupabase(REVENUE_COL, orgId, sbEntries)
      .catch((e) => console.warn('[supabase dual-write] late failure:', e?.message ?? e));
    // #387 — force a re-fetch so the Supabase-backed table reflects the new rows
    // immediately without requiring navigation. No-op when DATA_LAYER=firestore
    // (onSnapshot self-updates).
    refreshRevenue();
  }, [orgId, fleetForCity, refreshRevenue]);

  // ── Import Stripe/XSlide revenue (batch, chunked, source-suffixed doc ID) ──
  // Sibling to importRevenueDays with ONE deliberate difference: the doc id
  // carries a 'stripe' suffix (orgDocId(orgId, date, location, 'stripe')) so a
  // Stripe day can never collide with — and silently overwrite — a Hopp day for
  // the same date+location. Every row is also stamped franchiseExempt: true
  // (this money never had a Hopp platform cut taken) and source: 'stripe-xslide'.
  const importStripeRevenue = useCallback(async (days) => {
    if (!orgId) throw new Error('importStripeRevenue: no active org');
    const uid = auth.currentUser?.uid ?? null;
    const sbEntries = [];
    for (let i = 0; i < days.length; i += BATCH_SIZE) {
      const chunk = days.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach((day) => {
        const docId = orgDocId(orgId, day.date, day.location || 'global', 'stripe');
        const cityKey = day.location || day.city || null;
        const fleet = cityKey ? fleetForCity(cityKey) : null;
        const fleetId = fleet?._docId ?? null;
        const docData = {
          ...day,
          orgId,
          createdByUid: uid,
          source: 'stripe-xslide',
          franchiseExempt: true,
          ...(fleetId ? { fleetId } : {}),
        };
        batch.set(doc(db, REVENUE_COL, docId), docData); // setDoc via batch → overwrites
        sbEntries.push({ id: docId, data: docData });
      });
      await safeWrite(
        () => batch.commit(),
        { rethrow: true, errorMessage: 'Stripe revenue import failed mid-batch' },
      );
    }
    await dualWriteSupabase(REVENUE_COL, orgId, sbEntries)
      .catch((e) => console.warn('[supabase dual-write] late failure:', e?.message ?? e));
    refreshRevenue();
  }, [orgId, fleetForCity, refreshRevenue]);

  // ── Delete a single day ───────────────────────────────────────────────────
  const deleteRevenueDay = useCallback(async (docId) => {
    await orgDelete(REVENUE_COL, docId, { rethrow: true, errorMessage: 'Failed to delete revenue entry' });
    // #479 — mirror the delete to Supabase so the stores don't drift after the flip.
    await dualDeleteSupabase(REVENUE_COL, orgId, docId);
    // #387 — re-fetch so the deleted row disappears immediately under DATA_LAYER=supabase.
    refreshRevenue();
  }, [orgId, refreshRevenue]);

  // ── Clear all revenue data (THIS org only) ────────────────────────────────
  const clearAllRevenue = useCallback(async () => {
    if (!orgId) throw new Error('clearAllRevenue: no active org');
    // Paginated delete to avoid OOM on large collections (bug-73).
    let more = true;
    while (more) {
      // eslint-disable-next-line no-await-in-loop
      const snap = await getDocs(query(collection(db, REVENUE_COL), where('orgId', '==', orgId), limit(BATCH_SIZE)));
      if (snap.empty) break;
      const batch = writeBatch(db);
      snap.docs.forEach((d) => batch.delete(d.ref));
      // eslint-disable-next-line no-await-in-loop
      await safeWrite(
        () => batch.commit(),
        { rethrow: true, errorMessage: 'Failed to clear revenue data' },
      );
      more = snap.docs.length === BATCH_SIZE;
    }
    // #479 — mirror the full clear to Supabase so the stores don't drift after the flip.
    await dualClearSupabase(REVENUE_COL, orgId);
    // #387 — re-fetch so the cleared table is reflected immediately under DATA_LAYER=supabase.
    refreshRevenue();
  }, [orgId, refreshRevenue]);

  // BUG #301 — memoize the context value to prevent unnecessary Firestore reconnects
  const value = useMemo(() => ({
    revenueData,
    revenueLoading,
    snapshotError: error ? error.message : null,
    importRevenueDays,
    importStripeRevenue,
    deleteRevenueDay,
    clearAllRevenue,
  }), [
    revenueData, revenueLoading, error, importRevenueDays, importStripeRevenue,
    deleteRevenueDay, clearAllRevenue,
  ]);

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
