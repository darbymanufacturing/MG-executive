import { createContext, useContext, useCallback, useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  collection, doc, onSnapshot,
  addDoc, updateDoc, deleteDoc, setDoc, writeBatch, getDocs,
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { DEFAULT_CONFIG } from '../utils/constants.js';
import { SAMPLE_COSTS, SAMPLE_CONFIG } from '../utils/sampleData.js';

// Firestore paths
const COSTS_COL = 'costs';
const CONFIG_DOC = 'config/fleet';
const BATCH_SIZE = 450; // safely below Firestore's 500-op batch limit

const CostContext = createContext(null);

export function CostProvider({ children }) {
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
        // First time — write defaults
        setDoc(doc(db, CONFIG_DOC), DEFAULT_CONFIG);
      }
      setConfigLoaded(true);
    });

    return () => { unsubCosts(); unsubConfig(); };
  }, []);

  // ── CRUD ──────────────────────────────────────────────────────────────────

  const addCost = useCallback(async (costData) => {
    const now = new Date().toISOString();
    const newCost = { ...costData, id: uuidv4(), createdAt: now, updatedAt: now };
    await addDoc(collection(db, COSTS_COL), newCost);
    return newCost;
  }, []);

  const updateCost = useCallback(async (id, costData) => {
    // Find the Firestore document by the app-level id field
    const cost = costs.find((c) => c.id === id);
    if (!cost?._docId) return;
    await updateDoc(doc(db, COSTS_COL, cost._docId), {
      ...costData,
      id,
      updatedAt: new Date().toISOString(),
    });
  }, [costs]);

  const deleteCost = useCallback(async (id) => {
    const cost = costs.find((c) => c.id === id);
    if (!cost?._docId) return;
    await deleteDoc(doc(db, COSTS_COL, cost._docId));
  }, [costs]);

  const getCostById = useCallback((id) => costs.find((c) => c.id === id), [costs]);

  // ── Config ────────────────────────────────────────────────────────────────

  const updateConfig = useCallback(async (updates) => {
    const next = { ...config, ...updates };
    setConfig(next); // optimistic local update
    await setDoc(doc(db, CONFIG_DOC), next);
  }, [config]);

  // ── Sample data ───────────────────────────────────────────────────────────

  const loadSampleData = useCallback(async () => {
    // Delete existing costs in chunks (Firestore batch limit = 500)
    const existingSnap = await getDocs(collection(db, COSTS_COL));
    for (let i = 0; i < existingSnap.docs.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      existingSnap.docs.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    // Add sample costs in chunks
    for (let i = 0; i < SAMPLE_COSTS.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      SAMPLE_COSTS.slice(i, i + BATCH_SIZE).forEach((cost) => {
        const ref = doc(collection(db, COSTS_COL));
        batch.set(ref, cost);
      });
      await batch.commit();
    }

    await setDoc(doc(db, CONFIG_DOC), SAMPLE_CONFIG);
  }, []);

  const clearAllData = useCallback(async () => {
    const existingSnap = await getDocs(collection(db, COSTS_COL));
    for (let i = 0; i < existingSnap.docs.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      existingSnap.docs.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    await setDoc(doc(db, CONFIG_DOC), DEFAULT_CONFIG);
  }, []);

  // ── Import ────────────────────────────────────────────────────────────────

  const importData = useCallback(async (data, mode = 'replace') => {
    const batch = writeBatch(db);

    if (mode === 'replace') {
      // Delete all existing costs
      const existingSnap = await getDocs(collection(db, COSTS_COL));
      existingSnap.docs.forEach((d) => batch.delete(d.ref));
    }

    // Add imported costs — in merge mode skip by id (if present) or by name+startDate composite
    const existingIds        = new Set(costs.filter((c) => c.id).map((c) => c.id));
    const existingComposites = new Set(costs.map((c) => `${c.name}__${c.startDate}__${c.frequency}`));
    (data.costs || []).forEach((cost) => {
      if (mode === 'merge') {
        if (cost.id && existingIds.has(cost.id)) return;
        if (!cost.id && existingComposites.has(`${cost.name}__${cost.startDate}__${cost.frequency}`)) return;
      }
      const ref = doc(collection(db, COSTS_COL));
      batch.set(ref, { ...cost, id: cost.id || uuidv4() });
    });

    await batch.commit();

    if (data.config && mode === 'replace') {
      await setDoc(doc(db, CONFIG_DOC), data.config);
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
