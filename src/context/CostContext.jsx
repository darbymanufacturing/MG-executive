import { createContext, useContext, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useLocalStorage } from '../hooks/useLocalStorage.js';
import { STORAGE_KEYS, DEFAULT_CONFIG } from '../utils/constants.js';
import { SAMPLE_COSTS, SAMPLE_CONFIG } from '../utils/sampleData.js';

const CostContext = createContext(null);

export function CostProvider({ children }) {
  const [costs, setCosts] = useLocalStorage(STORAGE_KEYS.COSTS, []);
  const [config, setConfig] = useLocalStorage(STORAGE_KEYS.CONFIG, DEFAULT_CONFIG);

  // ── CRUD ──────────────────────────────────────────────────────────────────

  const addCost = useCallback((costData) => {
    const now = new Date().toISOString();
    const newCost = { ...costData, id: uuidv4(), createdAt: now, updatedAt: now };
    setCosts((prev) => [...prev, newCost]);
    return newCost;
  }, [setCosts]);

  const updateCost = useCallback((id, costData) => {
    setCosts((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, ...costData, id, updatedAt: new Date().toISOString() } : c
      )
    );
  }, [setCosts]);

  const deleteCost = useCallback((id) => {
    setCosts((prev) => prev.filter((c) => c.id !== id));
  }, [setCosts]);

  const getCostById = useCallback((id) => costs.find((c) => c.id === id), [costs]);

  // ── Config ────────────────────────────────────────────────────────────────

  const updateConfig = useCallback((updates) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  }, [setConfig]);

  // ── Sample data ───────────────────────────────────────────────────────────

  const loadSampleData = useCallback(() => {
    setCosts(SAMPLE_COSTS);
    setConfig(SAMPLE_CONFIG);
  }, [setCosts, setConfig]);

  const clearAllData = useCallback(() => {
    setCosts([]);
    setConfig(DEFAULT_CONFIG);
  }, [setCosts, setConfig]);

  // ── Import ────────────────────────────────────────────────────────────────

  const importData = useCallback((data, mode = 'replace') => {
    if (mode === 'replace') {
      setCosts(data.costs || []);
      if (data.config) setConfig(data.config);
    } else {
      // Merge: skip duplicates by id
      setCosts((prev) => {
        const existingIds = new Set(prev.map((c) => c.id));
        const newOnes = (data.costs || []).filter((c) => !existingIds.has(c.id));
        return [...prev, ...newOnes];
      });
    }
  }, [setCosts, setConfig]);

  return (
    <CostContext.Provider
      value={{
        costs,
        config,
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
