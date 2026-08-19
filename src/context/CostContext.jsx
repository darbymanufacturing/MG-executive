import { createContext, useContext, useCallback, useEffect, useMemo, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  collection, doc, writeBatch, getDocs, query, where, limit,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';
import { DEFAULT_CONFIG } from '../utils/constants.js';
import { SAMPLE_COSTS, SAMPLE_CONFIG } from '../utils/sampleData.js';
import { useOrg } from './OrgContext.jsx';
import { useOrgCollection } from '../hooks/useOrgCollection.js';
import { useOrgDoc } from '../hooks/useOrgDoc.js';
import { orgWrite, orgUpdate, orgDelete } from '../hooks/orgWrite.js';
import { orgDocId } from '../utils/orgDocId.js';

// ── Firestore paths (ADR-0002: flat collections + orgId; ADR-0003 query layer) ──
const COSTS_COL  = 'costs';
const CONFIG_COL = 'config';
// Singleton fleet config is org-scoped by composite doc id: `config/${orgId}_fleet`
// (was `config/fleet` pre-Phase-2). See docs/SCHEMA.md.
const fleetConfigId = (orgId) => `${orgId}_fleet`;

const BATCH_SIZE = 450; // safely below Firestore's 500-op batch limit
// #365 — free-tier cap on the previously-unbounded costs listener. orderBy is
// omitted on purpose: sample/imported costs may lack createdAt, and orderBy would
// exclude them. Preserved verbatim through the Phase-2 useOrgCollection conversion.
const MAX_COSTS = 2000;

const CostContext = createContext(null);

export function CostProvider({ children }) {
  const { orgId } = useOrg();
  // Per-org bootstrap guard: scoped to this provider instance (not module-level) so
  // it resets on unmount/remount (org switch, sign-out). Prevents StrictMode double-write.
  const bootstrappedRef = useRef(new Set());
  const configDocId = orgId ? fleetConfigId(orgId) : null;

  // ── Real-time reads through the locked org layer (ADR-0003) ──────────────────
  // Both hooks inject where('orgId','==',orgId) and throw if the org resolved but
  // is absent — costs/config can never leak across orgs or load unscoped.
  const { items: costs, loading: costsLoading } = useOrgCollection(COSTS_COL, { limit: MAX_COSTS });
  const { item: configItem, loading: configLoading } = useOrgDoc(CONFIG_COL, configDocId);

  // Config is derived from the org doc (minus the synthetic _docId), falling back to
  // defaults. Optimistic update + rollback come for free from onSnapshot latency
  // compensation, so no manual local config state is needed anymore.
  const config = useMemo(() => {
    if (!configItem) return DEFAULT_CONFIG;
    const { _docId, ...configData } = configItem;
    return configData;
  }, [configItem]);

  const loading = costsLoading || configLoading;

  // First load for an org with no config doc → silently seed defaults (org-stamped),
  // once per org. Mirrors the pre-Phase-2 bootstrap; no setState so it's effect-safe.
  useEffect(() => {
    if (configLoading || !configDocId) return;
    if (!configItem && !bootstrappedRef.current.has(configDocId)) {
      bootstrappedRef.current.add(configDocId);
      orgWrite(CONFIG_COL, DEFAULT_CONFIG, { id: configDocId, silent: true });
    }
  }, [configItem, configLoading, configDocId]);

  // ── CRUD ─────────────────────────────────────────────────────────────────────

  const addCost = useCallback(async (costData) => {
    const now = new Date().toISOString();
    // Keep ISO-string timestamps + the business `id` (uuid); orgWrite adds orgId + createdByUid.
    const newCost = { ...costData, id: uuidv4(), createdAt: now, updatedAt: now };
    await orgWrite(COSTS_COL, newCost, { rethrow: true, errorMessage: 'Failed to save cost' });
    return newCost;
  }, []);

  const updateCost = useCallback(async (id, costData) => {
    // Find the Firestore document by the app-level id field
    const cost = costs.find((c) => c.id === id);
    if (!cost?._docId) return;
    await orgUpdate(
      COSTS_COL,
      cost._docId,
      { ...costData, id, updatedAt: new Date().toISOString() },
      { rethrow: true, errorMessage: 'Failed to update cost' },
    );
  }, [costs]);

  const deleteCost = useCallback(async (id) => {
    const cost = costs.find((c) => c.id === id);
    if (!cost?._docId) return;
    await orgDelete(COSTS_COL, cost._docId, { rethrow: true, errorMessage: 'Failed to delete cost' });
  }, [costs]);

  // ADR-0027 — mark/clear an upcoming payment's settlement for a given month.
  // status: 'committed' | 'paid' to set, or null to undo (back to "to pay").
  // Stores a per-month map on the cost: settlements = { 'YYYY-MM': { status, at } }.
  const setCostSettlement = useCallback(async (id, period, status) => {
    const cost = costs.find((c) => c.id === id);
    if (!cost?._docId || !period) return;
    const settlements = { ...(cost.settlements || {}) };
    if (status === 'committed' || status === 'paid') {
      settlements[period] = { status, at: new Date().toISOString() };
    } else {
      delete settlements[period]; // undo → un-settled
    }
    // Pass the COMPLETE map; orgUpdate shallow-merges `data || patch`, so this
    // replaces the settlements field wholesale (deletions included) without clobber.
    await orgUpdate(
      COSTS_COL,
      cost._docId,
      { settlements, id, updatedAt: new Date().toISOString() },
      { rethrow: true, errorMessage: 'Failed to update payment status' },
    );
  }, [costs]);

  const getCostById = useCallback((id) => costs.find((c) => c.id === id), [costs]);

  // ── Bulk (multi-edit) ─────────────────────────────────────────────────────────
  // Apply a partial patch to (or delete) many costs at once. Both resolve the
  // app-level `id` → Firestore `_docId` and go through the org-scoped write path
  // (orgUpdate/orgDelete), chunked to bound concurrency.
  const bulkUpdateCosts = useCallback(async (ids, patch) => {
    const idSet = new Set(ids);
    const targets = costs.filter((c) => idSet.has(c.id) && c._docId);
    const stamp = new Date().toISOString();
    const CHUNK = 25;
    for (let i = 0; i < targets.length; i += CHUNK) {
      const slice = targets.slice(i, i + CHUNK);
      await Promise.all(slice.map((c) => orgUpdate(
        COSTS_COL, c._docId, { ...patch, id: c.id, updatedAt: stamp },
        { rethrow: true, errorMessage: 'Bulk update failed' },
      )));
    }
    return targets.length;
  }, [costs]);

  const bulkDeleteCosts = useCallback(async (ids) => {
    const idSet = new Set(ids);
    const targets = costs.filter((c) => idSet.has(c.id) && c._docId);
    const CHUNK = 25;
    for (let i = 0; i < targets.length; i += CHUNK) {
      const slice = targets.slice(i, i + CHUNK);
      await Promise.all(slice.map((c) => orgDelete(
        COSTS_COL, c._docId, { rethrow: true, errorMessage: 'Bulk delete failed' },
      )));
    }
    return targets.length;
  }, [costs]);

  // ── Config ─────────────────────────────────────────────────────────────────────

  const updateConfig = useCallback(async (updates) => {
    if (!configDocId) return;
    // Full-replace (matches the pre-Phase-2 setDoc semantics). Strip updatedAt so it
    // always bumps; orgWrite re-stamps orgId and preserves createdAt if present.
    const { updatedAt: _drop, ...base } = config;
    const next = { ...base, ...updates };
    await orgWrite(CONFIG_COL, next, {
      id: configDocId,
      rethrow: true,
      errorMessage: 'Failed to save config — change reverted',
    });
  }, [config, configDocId]);

  // ── Location management (#557) ────────────────────────────────────────────
  // Deduplicate case-insensitively + trim so "Athens" and "athens" don't coexist.

  const addLocation = useCallback(async (name) => {
    const trimmed = name?.trim();
    if (!trimmed) return;
    const existing = config.locations ?? [];
    const duplicate = existing.some(
      (loc) => loc.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (duplicate) return;
    await updateConfig({ locations: [...existing, trimmed] });
  }, [config.locations, updateConfig]);

  const removeLocation = useCallback(async (name) => {
    const existing = config.locations ?? [];
    await updateConfig({ locations: existing.filter((loc) => loc !== name) });
  }, [config.locations, updateConfig]);

  // ── Sample data ──────────────────────────────────────────────────────────────

  const loadSampleData = useCallback(async () => {
    if (!orgId || !configDocId) throw new Error('loadSampleData: no active org');
    const uid = auth.currentUser?.uid ?? null;

    // Delete THIS org's existing costs in paginated chunks (org-filtered — never another org's).
    // Paginated to avoid loading the entire collection into browser memory (bug-73).
    {
      let more = true;
      while (more) {
        // eslint-disable-next-line no-await-in-loop
        const snap = await getDocs(query(collection(db, COSTS_COL), where('orgId', '==', orgId), limit(BATCH_SIZE)));
        if (snap.empty) break;
        const batch = writeBatch(db);
        snap.docs.forEach((d) => batch.delete(d.ref));
        // eslint-disable-next-line no-await-in-loop
        await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'Sample data load failed while clearing old costs' });
        more = snap.docs.length === BATCH_SIZE;
      }
    }

    // Add sample costs in chunks, org-stamped.
    for (let i = 0; i < SAMPLE_COSTS.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      SAMPLE_COSTS.slice(i, i + BATCH_SIZE).forEach((cost) => {
        const ref = doc(collection(db, COSTS_COL));
        batch.set(ref, { ...cost, orgId, createdByUid: uid });
      });
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'Sample data load failed while seeding costs' });
    }

    await orgWrite(CONFIG_COL, SAMPLE_CONFIG, {
      id: configDocId, rethrow: true, errorMessage: 'Sample data load failed while writing config',
    });
  }, [orgId, configDocId]);

  const clearAllData = useCallback(async () => {
    if (!orgId || !configDocId) throw new Error('clearAllData: no active org');
    // Paginated delete to avoid OOM on large collections (bug-73).
    {
      let more = true;
      while (more) {
        // eslint-disable-next-line no-await-in-loop
        const snap = await getDocs(query(collection(db, COSTS_COL), where('orgId', '==', orgId), limit(BATCH_SIZE)));
        if (snap.empty) break;
        const batch = writeBatch(db);
        snap.docs.forEach((d) => batch.delete(d.ref));
        // eslint-disable-next-line no-await-in-loop
        await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'Failed to clear costs' });
        more = snap.docs.length === BATCH_SIZE;
      }
    }
    await orgWrite(CONFIG_COL, DEFAULT_CONFIG, {
      id: configDocId, rethrow: true, errorMessage: 'Failed to reset config to defaults',
    });
  }, [orgId, configDocId]);

  // ── Import ─────────────────────────────────────────────────────────────────────

  const importData = useCallback(async (data, mode = 'replace') => {
    if (!orgId || !configDocId) throw new Error('importData: no active org');
    const uid = auth.currentUser?.uid ?? null;

    // BUG #42 — split delete + insert into separate batched phases so combined
    // ops never exceed Firestore's 500-op limit.

    if (mode === 'replace') {
      // Phase 1: delete THIS org's existing docs in chunks of BATCH_SIZE
      const docsSnap = await getDocs(query(collection(db, COSTS_COL), where('orgId', '==', orgId)));
      const allDocs = docsSnap.docs;
      for (let i = 0; i < allDocs.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        allDocs.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
        await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'Cost import failed while clearing old costs' });
      }
    }

    // Phase 2: insert imported costs in chunks of BATCH_SIZE
    const existingIds        = new Set(costs.filter((c) => c.id).map((c) => c.id));
    const existingComposites = new Set(costs.map((c) => `${c.name}__${c.startDate}__${c.frequency}`));
    const costsToInsert = (data.costs || []).filter((cost) => {
      if (mode === 'merge') {
        if (cost.id && existingIds.has(cost.id)) return false;
        if (!cost.id && existingComposites.has(`${cost.name}__${cost.startDate}__${cost.frequency}`)) return false;
      }
      return true;
    });

    for (let i = 0; i < costsToInsert.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      costsToInsert.slice(i, i + BATCH_SIZE).forEach((cost) => {
        const id = cost.id || crypto.randomUUID(); // compute once so _docId === id field
        const ref = doc(db, COSTS_COL, id);
        batch.set(ref, { ...cost, id, orgId, createdByUid: uid });
      });
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'Cost import failed mid-batch' });
    }

    if (data.config && mode === 'replace') {
      await orgWrite(CONFIG_COL, data.config, {
        id: configDocId, rethrow: true, errorMessage: 'Failed to write imported config',
      });
    }
  }, [costs, orgId, configDocId]);

  // ── FF-2 bank import ─────────────────────────────────────────────────────────
  // Import Alpha Bank CSV rows as cost entries. Only DEBIT rows become costs;
  // credits (income) are shown read-only in the review and never written here
  // (Hopp auto-sync already owns revenue — avoids double-counting). Idempotent:
  // dedup is by `_bankTxId` (the bank's transaction id), and the doc id is
  // deterministic, so re-importing the same file is a safe no-op. Writes go
  // through orgWrite (the seam → Supabase, the live read path) — NOT the
  // Firestore-only `importData` batch.
  const importBankCosts = useCallback(async (rows) => {
    if (!orgId) throw new Error('importBankCosts: no active org');
    const debits = (rows || []).filter((r) => r.direction === 'debit');
    const existingTxIds = new Set(costs.filter((c) => c._bankTxId).map((c) => c._bankTxId));
    const toImport = debits.filter((r) => r._bankTxId && !existingTxIds.has(r._bankTxId));
    const now = new Date().toISOString();
    const CHUNK = 25; // bound concurrency

    let written = 0;
    for (let i = 0; i < toImport.length; i += CHUNK) {
      const slice = toImport.slice(i, i + CHUNK);
      await Promise.all(slice.map((r) => {
        const id = orgDocId(orgId, 'banktx', r._bankTxId);
        const cost = {
          id,
          name: r.cleanDesc || r.rawDesc || 'Bank transaction',
          amount: Math.abs(Number(r.amount) || 0),
          startDate: r.date,
          frequency: 'one-time',
          category: r.category || 'variable',
          notes: r.rawDesc || null,
          branch: r.branch || null,
          _bankTxId: r._bankTxId,
          source: 'alphabank-csv',
          createdAt: now,
          updatedAt: now,
        };
        return orgWrite(COSTS_COL, cost, { id, rethrow: true, errorMessage: 'Bank import failed' });
      }));
      written += slice.length;
    }

    return { written, duplicates: debits.length - toImport.length };
  }, [costs, orgId]);

  // Book Stripe/XSlide processing fees as cost rows — one per calendar month,
  // summed by the Stripe import panel from the raw CSV `Fee` column. Same
  // idempotency shape as importBankCosts: a deterministic doc id
  // (orgDocId(orgId,'stripefee',monthKey)) makes re-importing an overlapping
  // range a safe overwrite of that month's fee total, never a duplicate.
  const importStripeFees = useCallback(async (monthlyFees) => {
    if (!orgId) throw new Error('importStripeFees: no active org');
    const now = new Date().toISOString();
    await Promise.all((monthlyFees || []).map(({ monthKey, monthLabel, amount }) => {
      const id = orgDocId(orgId, 'stripefee', monthKey);
      const [y, m] = monthKey.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const cost = {
        id,
        name: `Stripe fees — ${monthLabel}`,
        amount: Math.round((Math.abs(Number(amount) || 0) + Number.EPSILON) * 100) / 100,
        startDate: `${monthKey}-${String(lastDay).padStart(2, '0')}`,
        frequency: 'one-time',
        category: 'Transaction Fees',
        source: 'stripe-xslide',
        createdAt: now,
        updatedAt: now,
      };
      return orgWrite(COSTS_COL, cost, { id, rethrow: true, errorMessage: 'Stripe fee import failed' });
    }));
  }, [orgId]);

  return (
    <CostContext.Provider
      value={{
        costs,
        config,
        loading,
        addCost,
        updateCost,
        deleteCost,
        setCostSettlement,
        bulkUpdateCosts,
        bulkDeleteCosts,
        getCostById,
        updateConfig,
        addLocation,
        removeLocation,
        loadSampleData,
        clearAllData,
        importData,
        importBankCosts,
        importStripeFees,
      }}
    >
      {children}
    </CostContext.Provider>
  );
}

export function useCosts() {
  const ctx = useContext(CostContext);
  if (!ctx) throw new Error('useCosts must be used inside <CostProvider>');
  return ctx;
}
