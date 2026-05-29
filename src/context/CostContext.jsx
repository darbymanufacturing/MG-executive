import { createContext, useContext, useCallback, useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  collection, doc, onSnapshot,
  addDoc, updateDoc, deleteDoc, setDoc, writeBatch, getDocs,
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';
import { DEFAULT_CONFIG } from '../utils/constants.js';
import { SAMPLE_COSTS, SAMPLE_CONFIG } from '../utils/sampleData.js';
import { useAuth } from './AuthContext.jsx';

// Firestore paths
const COSTS_COL = 'costs';
const CONFIG_DOC = 'config/fleet';
const BATCH_SIZE = 450; // safely below Firestore's 500-op batch limit

const CostContext = createContext(null);

// Module-level flag: prevents StrictMode double-invoke from writing bootstrap defaults twice
let configBootstrapped = false;

export function CostProvider({ children }) {
  const { user } = useAuth();
  const [costs, setCosts] = useState([]);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  // Track each listener independently to avoid premature loading=false
  const [costsLoaded,  setCostsLoaded]  = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);

  useEffect(() => {
    if (costsLoaded && configLoaded) setLoading(false);
  }, [costsLoaded, configLoaded]);

  // ── Real-time listeners ───────────────────────────────────────────────────

  useEffect(() => {
    // Reset state when user changes (e.g. sign out or different user signs in)
    setCosts([]);
    setConfig(DEFAULT_CONFIG);
    setLoading(true);
    setCostsLoaded(false);
    setConfigLoaded(false);

    // Listen to costs collection
    const unsubCosts = onSnapshot(collection(db, COSTS_COL), (snap) => {
      const items = snap.docs.map((d) => ({ ...d.data(), _docId: d.id }));
      setCosts(items);
      setCostsLoaded(true);
    });

    // Listen to config document
    const unsubConfig = onSnapshot(doc(db, CONFIG_DOC), (snap) => {
      if (snap.exists()) {
        setConfig(snap.data());
      } else {
        // First time — write defaults (silent bootstrap, guarded against StrictMode double-fire)
        if (!configBootstrapped) {
          configBootstrapped = true;
          safeWrite(() => setDoc(doc(db, CONFIG_DOC), DEFAULT_CONFIG), { silent: true });
        }
      }
      setConfigLoaded(true);
    });

    return () => { unsubCosts(); unsubConfig(); };
  }, [user]);

  // ── CRUD ──────────────────────────────────────────────────────────────────

  const addCost = useCallback(async (costData) => {
    const now = new Date().toISOString();
    const newCost = { ...costData, id: uuidv4(), createdAt: now, updatedAt: now };
    await safeWrite(
      () => addDoc(collection(db, COSTS_COL), newCost),
      { rethrow: true, errorMessage: 'Failed to save cost' },
    );
    return newCost;
  }, []);

  const updateCost = useCallback(async (id, costData) => {
    // Find the Firestore document by the app-level id field
    const cost = costs.find((c) => c.id === id);
    if (!cost?._docId) return;
    await safeWrite(
      () => updateDoc(doc(db, COSTS_COL, cost._docId), {
        ...costData,
        id,
        updatedAt: new Date().toISOString(),
      }),
      { rethrow: true, errorMessage: 'Failed to update cost' },
    );
  }, [costs]);

  const deleteCost = useCallback(async (id) => {
    const cost = costs.find((c) => c.id === id);
    if (!cost?._docId) return;
    await safeWrite(
      () => deleteDoc(doc(db, COSTS_COL, cost._docId)),
      { rethrow: true, errorMessage: 'Failed to delete cost' },
    );
  }, [costs]);

  const getCostById = useCallback((id) => costs.find((c) => c.id === id), [costs]);

  // ── Config ────────────────────────────────────────────────────────────────

  const updateConfig = useCallback(async (updates) => {
    const previousConfig = config;
    const next = { ...config, ...updates };
    setConfig(next); // optimistic local update
    await safeWrite(
      () => setDoc(doc(db, CONFIG_DOC), next),
      {
        rethrow: true,
        errorMessage: 'Failed to save config — change reverted',
        optimisticRollback: () => setConfig(previousConfig),
      },
    );
  }, [config]);

  // ── Sample data ───────────────────────────────────────────────────────────

  const loadSampleData = useCallback(async () => {
    // Delete existing costs in chunks (Firestore batch limit = 500)
    const existingSnap = await getDocs(collection(db, COSTS_COL));
    for (let i = 0; i < existingSnap.docs.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      existingSnap.docs.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'Sample data load failed while clearing old costs' });
    }

    // Add sample costs in chunks
    for (let i = 0; i < SAMPLE_COSTS.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      SAMPLE_COSTS.slice(i, i + BATCH_SIZE).forEach((cost) => {
        const ref = doc(collection(db, COSTS_COL));
        batch.set(ref, cost);
      });
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'Sample data load failed while seeding costs' });
    }

    await safeWrite(
      () => setDoc(doc(db, CONFIG_DOC), SAMPLE_CONFIG),
      { rethrow: true, errorMessage: 'Sample data load failed while writing config' },
    );
  }, []);

  const clearAllData = useCallback(async () => {
    const existingSnap = await getDocs(collection(db, COSTS_COL));
    for (let i = 0; i < existingSnap.docs.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      existingSnap.docs.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'Failed to clear costs' });
    }
    await safeWrite(
      () => setDoc(doc(db, CONFIG_DOC), DEFAULT_CONFIG),
      { rethrow: true, errorMessage: 'Failed to reset config to defaults' },
    );
  }, []);

  // ── Import ────────────────────────────────────────────────────────────────

  const importData = useCallback(async (data, mode = 'replace') => {
    // BUG #42 — split delete + insert into separate batched phases so combined
    // ops never exceed Firestore's 500-op limit.

    if (mode === 'replace') {
      // Phase 1: delete existing docs in chunks of BATCH_SIZE
      const docsSnap = await getDocs(collection(db, COSTS_COL));
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
        const ref = doc(db, COSTS_COL, cost.id || crypto.randomUUID());
        batch.set(ref, { ...cost, id: cost.id || crypto.randomUUID() });
      });
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'Cost import failed mid-batch' });
    }

    if (data.config && mode === 'replace') {
      await safeWrite(
        () => setDoc(doc(db, CONFIG_DOC), data.config),
        { rethrow: true, errorMessage: 'Failed to write imported config' },
      );
    }
  }, [costs]);

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
