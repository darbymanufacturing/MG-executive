import { createContext, useContext, useCallback, useEffect, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  collection, doc, writeBatch, getDocs, query, where,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';
import { DEFAULT_CONFIG } from '../utils/constants.js';
import { SAMPLE_COSTS, SAMPLE_CONFIG } from '../utils/sampleData.js';
import { useOrg } from './OrgContext.jsx';
import { useOrgCollection } from '../hooks/useOrgCollection.js';
import { useOrgDoc } from '../hooks/useOrgDoc.js';
import { orgWrite, orgUpdate, orgDelete } from '../hooks/orgWrite.js';

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

// Per-org bootstrap guard: prevents a StrictMode double-write AND a re-bootstrap
// when a different org signs in within one session. Holds config doc-ids already seeded.
const bootstrappedConfigs = new Set();

export function CostProvider({ children }) {
  const { orgId } = useOrg();
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
    if (!configItem && !bootstrappedConfigs.has(configDocId)) {
      bootstrappedConfigs.add(configDocId);
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

  const getCostById = useCallback((id) => costs.find((c) => c.id === id), [costs]);

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

  // ── Sample data ──────────────────────────────────────────────────────────────

  const loadSampleData = useCallback(async () => {
    if (!orgId || !configDocId) throw new Error('loadSampleData: no active org');
    const uid = auth.currentUser?.uid ?? null;

    // Delete THIS org's existing costs in chunks (org-filtered — never another org's).
    const existingSnap = await getDocs(query(collection(db, COSTS_COL), where('orgId', '==', orgId)));
    for (let i = 0; i < existingSnap.docs.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      existingSnap.docs.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'Sample data load failed while clearing old costs' });
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
    const existingSnap = await getDocs(query(collection(db, COSTS_COL), where('orgId', '==', orgId)));
    for (let i = 0; i < existingSnap.docs.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      existingSnap.docs.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'Failed to clear costs' });
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

  return (
    <CostContext.Provider
      value={{
        costs,
        config,
        loading,
        addCost,
        updateCost,
        deleteCost,
        getCostById,
        updateConfig,
        loadSampleData,
        clearAllData,
        importData,
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
