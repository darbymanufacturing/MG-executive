import { createContext, useContext, useMemo } from 'react';
import { useOrgCollection } from '../hooks/useOrgCollection.js';

const RepairSessionContext = createContext(null);

export function RepairSessionProvider({ children }) {
  // Phase 2 (ADR-0003): org-scoped read. useOrgCollection injects
  // where('orgId','==',orgId) and throws if the org resolved but is absent.
  const { items, loading, error } = useOrgCollection('repairSessions', {
    orderBy: ['completedAt', 'desc'],
    limit: 100,
  });

  // Preserve the public shape: consumers read `.id` (was the Firestore doc id).
  const sessions = useMemo(
    () => items.map(({ _docId, ...rest }) => ({ id: _docId, ...rest })),
    [items],
  );

  const value = useMemo(
    () => ({ sessions, loading, snapshotError: error ? error.message : null }),
    [sessions, loading, error],
  );

  return (
    <RepairSessionContext.Provider value={value}>
      {children}
    </RepairSessionContext.Provider>
  );
}

export function useRepairSessions() {
  return useContext(RepairSessionContext);
}
