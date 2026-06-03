import { createContext, useContext, useCallback, useMemo } from 'react';
import { useOrg } from './OrgContext.jsx';
import { useOrgCollection } from '../hooks/useOrgCollection.js';
import { orgWrite, orgDelete } from '../hooks/orgWrite.js';
import { orgDocId } from '../utils/orgDocId.js';
import { mergeEntries } from '../utils/loanCalculations.js';

/**
 * FF-2 Phase C — multi-loan tracking (org-scoped, COMPANY-WIDE: ignores the FF-3
 * fleet switcher). One doc per loan, keyed deterministically by loan number, so
 * re-importing a loan's CSV merges (dedup by entry _bankTxId) rather than dupes.
 * Loan shape: { loanNumber, name, currentBalance, entries:[{date,type,principal,interest,amount,_bankTxId,rawDesc}] }
 */
const LOANS_COL = 'loans';
const LoansContext = createContext(null);

export function LoansProvider({ children }) {
  const { orgId } = useOrg();
  const { items: loans, loading } = useOrgCollection(LOANS_COL, { limit: 100 });

  // Upsert a loan from a parsed loan-CSV result. Returns the merged loan so the
  // caller can derive its interest-only cost rows.
  const upsertLoan = useCallback(async (parsed) => {
    if (!orgId) throw new Error('upsertLoan: no active org');
    if (!parsed?.loanNumber) throw new Error('upsertLoan: loan has no loan number');
    const id = orgDocId(orgId, 'loan', parsed.loanNumber);
    const existing = loans.find((l) => l.loanNumber === parsed.loanNumber);
    const entries = mergeEntries(existing?.entries ?? [], parsed.entries ?? []);
    const now = new Date().toISOString();
    const loan = {
      id,
      loanNumber: parsed.loanNumber,
      name: parsed.name || existing?.name || `Loan ${parsed.loanNumber}`,
      currentBalance: parsed.currentBalance ?? existing?.currentBalance ?? null,
      entries,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    await orgWrite(LOANS_COL, loan, { id, rethrow: true, errorMessage: 'Failed to save loan' });
    return loan;
  }, [orgId, loans]);

  const deleteLoan = useCallback(async (docId) => {
    await orgDelete(LOANS_COL, docId, { rethrow: true, errorMessage: 'Failed to delete loan' });
  }, []);

  const value = useMemo(
    () => ({ loans, loading, upsertLoan, deleteLoan }),
    [loans, loading, upsertLoan, deleteLoan],
  );
  return <LoansContext.Provider value={value}>{children}</LoansContext.Provider>;
}

export function useLoans() {
  const ctx = useContext(LoansContext);
  if (!ctx) throw new Error('useLoans must be used inside <LoansProvider>');
  return ctx;
}
