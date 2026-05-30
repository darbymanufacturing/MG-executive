import { createContext, useContext, useMemo } from 'react';
import { useOrgCollection } from '../hooks/useOrgCollection.js';
import { orgWrite, orgUpdate, orgDelete } from '../hooks/orgWrite.js';

const RepairProcedureContext = createContext(null);

const COL = 'repairProcedures';

export function RepairProcedureProvider({ children }) {
  // Phase 2 (ADR-0003): org-scoped read + writes.
  const { items, loading, error } = useOrgCollection(COL, {
    orderBy: ['createdAt', 'desc'],
    limit: 500,
  });

  // Preserve the public shape: consumers read `.id` (was the Firestore doc id).
  const procedures = useMemo(
    () => items.map(({ _docId, ...rest }) => ({ id: _docId, ...rest })),
    [items],
  );

  const addProcedure = async (data) => {
    await orgWrite(COL, data, { rethrow: true, errorMessage: 'Failed to save repair procedure' });
  };

  const updateProcedure = async (id, data) => {
    await orgUpdate(COL, id, data, { rethrow: true, errorMessage: 'Failed to update repair procedure' });
  };

  const deleteProcedure = async (id) => {
    await orgDelete(COL, id, { rethrow: true, errorMessage: 'Failed to delete repair procedure' });
  };

  const value = useMemo(() => ({
    procedures, loading, snapshotError: error ? error.message : null,
    addProcedure, updateProcedure, deleteProcedure,
  }), [procedures, loading, error]);

  return (
    <RepairProcedureContext.Provider value={value}>
      {children}
    </RepairProcedureContext.Provider>
  );
}

export function useRepairProcedures() {
  return useContext(RepairProcedureContext);
}
