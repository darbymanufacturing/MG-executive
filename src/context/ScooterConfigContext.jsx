/**
 * ScooterConfigContext.jsx
 * Manages the `config/scooters` Firestore doc.
 * Stores tab configuration (order, enabled state) for the /scooters/:id page.
 *
 * Default config is written on first load if the doc doesn't exist.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';

const CONFIG_DOC = 'config/scooters';

const DEFAULT_TABS = [
  { id: 'details',   label: 'Details',   enabled: true,  order: 0 },
  { id: 'trips',     label: 'Trips',     enabled: true,  order: 1 },
  { id: 'events',    label: 'Events',    enabled: true,  order: 2 },
  { id: 'repairs',   label: 'Repairs',   enabled: true,  order: 3 },
  { id: 'finance',   label: 'Finance',   enabled: true,  order: 4 },
  { id: 'analytics', label: 'Analytics', enabled: false, order: 5 },
];

const ScooterConfigContext = createContext(null);

export function ScooterConfigProvider({ children }) {
  const [tabs,    setTabs]    = useState(DEFAULT_TABS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ref = doc(db, CONFIG_DOC);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        // Merge Firestore tabs with DEFAULT_TABS so new tabs added in code appear
        const stored  = data.tabs || [];
        const storedById = Object.fromEntries(stored.map((t) => [t.id, t]));
        const merged = DEFAULT_TABS.map((d) => ({
          ...d,
          ...(storedById[d.id] || {}),
        }));
        // Sort by saved order
        merged.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
        setTabs(merged);
      } else {
        // First load — write defaults (silent fire-and-forget; not actionable to user)
        safeWrite(() => setDoc(ref, { tabs: DEFAULT_TABS }), { silent: true });
        setTabs(DEFAULT_TABS);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const saveTabs = useCallback(async (newTabs) => {
    const ref = doc(db, CONFIG_DOC);
    await safeWrite(
      () => setDoc(ref, { tabs: newTabs }, { merge: true }),
      { rethrow: true, errorMessage: 'Failed to save scooter tab settings' },
    );
  }, []);

  /** Returns only enabled tabs, sorted by order */
  const enabledTabs = tabs
    .filter((t) => t.enabled)
    .sort((a, b) => a.order - b.order);

  return (
    <ScooterConfigContext.Provider value={{ tabs, enabledTabs, saveTabs, loading }}>
      {children}
    </ScooterConfigContext.Provider>
  );
}

export function useScooterConfig() {
  const ctx = useContext(ScooterConfigContext);
  if (!ctx) throw new Error('useScooterConfig must be used inside ScooterConfigProvider');
  return ctx;
}
