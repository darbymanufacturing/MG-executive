/**
 * ScooterConfigContext.jsx
 * Manages the org-scoped scooter-tabs config doc (Phase 2: config/${orgId}_scooters,
 * was config/scooters). Stores tab configuration (order, enabled state) for the
 * /scooters/:id page. Defaults are merged in from code so new tabs always appear.
 */

import { createContext, useContext, useMemo, useCallback } from 'react';
import { useOrg } from './OrgContext.jsx';
import { useOrgDoc } from '../hooks/useOrgDoc.js';
import { orgWrite } from '../hooks/orgWrite.js';

const CONFIG_COL = 'config';

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
  const { orgId } = useOrg();
  const docId = orgId ? `${orgId}_scooters` : null;
  const { item, loading } = useOrgDoc(CONFIG_COL, docId);

  // Merge stored tabs with DEFAULT_TABS by id so new tabs added in code appear,
  // then sort by saved order. (Same logic as the pre-Phase-2 onSnapshot handler.)
  const tabs = useMemo(() => {
    const stored = item?.tabs || [];
    const storedById = Object.fromEntries(stored.map((t) => [t.id, t]));
    return DEFAULT_TABS
      .map((d) => ({ ...d, ...(storedById[d.id] || {}) }))
      .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  }, [item]);

  const saveTabs = useCallback(async (newTabs) => {
    await orgWrite(CONFIG_COL, { tabs: newTabs }, {
      id: docId, merge: true, rethrow: true, errorMessage: 'Failed to save scooter tab settings',
    });
  }, [docId]);

  const enabledTabs = useMemo(
    () => tabs.filter((t) => t.enabled).sort((a, b) => a.order - b.order),
    [tabs],
  );

  const value = useMemo(
    () => ({ tabs, enabledTabs, saveTabs, loading }),
    [tabs, enabledTabs, saveTabs, loading],
  );

  return (
    <ScooterConfigContext.Provider value={value}>
      {children}
    </ScooterConfigContext.Provider>
  );
}

export function useScooterConfig() {
  const ctx = useContext(ScooterConfigContext);
  if (!ctx) throw new Error('useScooterConfig must be used inside ScooterConfigProvider');
  return ctx;
}
