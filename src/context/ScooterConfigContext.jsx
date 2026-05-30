import { createContext, useContext, useMemo, useCallback } from 'react';
import { useOrg } from './OrgContext.jsx';
import { useOrgDoc } from '../hooks/useOrgDoc.js';
import { orgWrite } from '../hooks/orgWrite.js';
import { DEFAULT_SCOOTER_TABS } from '../utils/scooterTabsConfig.js';

const ScooterConfigContext = createContext(null);
// Phase 2 (ADR-0002): org-scoped singleton — was config/scooters.
const CONFIG_COL = 'config';

export function ScooterConfigProvider({ children }) {
  const { orgId } = useOrg();
  const docId = orgId ? `${orgId}_scooters` : null;
  const { item, loading } = useOrgDoc(CONFIG_COL, docId);

  const tabs = useMemo(
    () => (item && Array.isArray(item.tabs) ? item.tabs : DEFAULT_SCOOTER_TABS),
    [item],
  );

  const saveTabs = useCallback(async (newTabs) => {
    await orgWrite(CONFIG_COL, { tabs: newTabs }, {
      id: docId, merge: true, rethrow: true, errorMessage: 'Failed to save tab settings',
    });
  }, [docId]);

  const value = useMemo(() => ({
    tabs,
    enabledTabs: tabs.filter((t) => t.enabled),
    saveTabs,
    loading,
  }), [tabs, loading, saveTabs]);

  return (
    <ScooterConfigContext.Provider value={value}>
      {children}
    </ScooterConfigContext.Provider>
  );
}

export function useScooterConfig() {
  return useContext(ScooterConfigContext);
}

export function useSafeScooterConfig() {
  let ctx;
  try {
    ctx = useScooterConfig();
  } catch {
    return { tabs: DEFAULT_SCOOTER_TABS, enabledTabs: DEFAULT_SCOOTER_TABS.filter(t => t.enabled), loading: false };
  }
  return ctx;
}
