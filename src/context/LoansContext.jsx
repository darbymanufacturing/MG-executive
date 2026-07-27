import { createContext, useContext, useCallback, useMemo } from 'react';
import { useOrg } from './OrgContext.jsx';
import { useOrgCollection } from '../hooks/useOrgCollection.js';
import { orgWrite, orgUpdate, orgDelete } from '../hooks/orgWrite.js';
import { orgDocId } from '../utils/orgDocId.js';
import { mergeEntries } from '../utils/loanCalculations.js';

/**
 * FF-2 Phase C — multi-loan tracking (org-scoped, COMPANY-WIDE: ignores the FF-3
 * fleet switcher). One doc per loan, keyed deterministically by loan number, so
 * re-importing a loan's CSV merges (dedup by entry _bankTxId) rather than dupes.
 * CSV-imported loan shape: { loanNumber, name, currentBalance, entries:[{date,type,principal,interest,amount,_bankTxId,rawDesc}] }
 *
 * Manual loans/credit cards (added directly on the Loans page, no bank CSV) share the
 * same `loans` collection so the page can list both kinds together. They have no
 * `loanNumber` (nothing to dedup against) and get a random deterministic id instead;
 * `manual: true` marks the origin and `entries` stays [] until/unless a CSV is ever
 * layered on top of them via upsertLoan. Shape (additive fields, no Firestore/Supabase
 * migration needed — `loans` is a JSONB-backed Supabase table, docs/SCHEMA.md):
 *   { name, type:'loan'|'credit-card', lender, principalAmount, creditLimit,
 *     currentBalance, interestRate, monthlyPayment, startDate, notes, manual:true, entries:[] }
 * `principalAmount` (loans) and `creditLimit` (cards) are separate fields — only the
 * one matching `type` is populated. `monthlyPayment` is reused for both "monthly
 * payment" (loan) and "minimum payment" (card) — same field, different UI label
 * (see loanUiHelpers.js `paymentLabel`/`lenderLabel`).
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

  // Manual add — a loan or credit card entered by hand (not from a bank CSV). `data`
  // is already normalized by LoanFormModal (numbers coerced, blanks → null).
  const addLoan = useCallback(async (data) => {
    if (!orgId) throw new Error('addLoan: no active org');
    const name = (data?.name ?? '').trim();
    if (!name) throw new Error('addLoan: name is required');
    const type = data.type === 'credit-card' ? 'credit-card' : 'loan';
    const id = orgDocId(orgId, 'loan', crypto.randomUUID());
    const now = new Date().toISOString();
    const loan = {
      id,
      name,
      type,
      lender: data.lender || null,
      principalAmount: type === 'loan' ? (data.principalAmount ?? null) : null,
      creditLimit: type === 'credit-card' ? (data.creditLimit ?? null) : null,
      currentBalance: data.currentBalance ?? null,
      interestRate: data.interestRate ?? null,
      monthlyPayment: data.monthlyPayment ?? null,
      startDate: data.startDate || null,
      notes: data.notes || null,
      manual: true,
      entries: [],
      createdAt: now,
      updatedAt: now,
    };
    await orgWrite(LOANS_COL, loan, { id, rethrow: true, errorMessage: 'Failed to save loan' });
    return loan;
  }, [orgId]);

  // Edit — works for manual loans/cards AND CSV-imported loans (lets the owner attach
  // a rate/monthly payment/notes to an imported loan without touching its entries/
  // currentBalance, which stay bank-derived). Partial patch, shallow-merged.
  const updateLoan = useCallback(async (docId, patch) => {
    if (!docId) throw new Error('updateLoan: docId is required');
    await orgUpdate(LOANS_COL, docId, patch, { rethrow: true, errorMessage: 'Failed to update loan' });
  }, []);

  const value = useMemo(
    () => ({ loans, loading, upsertLoan, deleteLoan, addLoan, updateLoan }),
    [loans, loading, upsertLoan, deleteLoan, addLoan, updateLoan],
  );
  return <LoansContext.Provider value={value}>{children}</LoansContext.Provider>;
}

export function useLoans() {
  const ctx = useContext(LoansContext);
  if (!ctx) throw new Error('useLoans must be used inside <LoansProvider>');
  return ctx;
}
