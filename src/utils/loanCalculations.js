/**
 * loanCalculations — FF-2 Phase C pure helpers.
 *
 * Core accounting rule (FUTURE_FEATURES §FF-2, gotcha #3):
 *   - INTEREST is the real P&L cost.
 *   - PRINCIPAL repayment is a balance-sheet move (debt paydown), NOT an expense.
 * So only interest entries flow into the cost history; principal is excluded
 * (it also appears as a debit in the account feed — counting it as a cost would
 * double-count).
 *
 * A loan: { loanNumber, name, currentBalance, entries:[{date,type,principal,interest,amount,_bankTxId,rawDesc}] }
 */

/** Σ principal repaid across the imported entries. */
export function totalPrincipalPaid(loan) {
  return (loan?.entries ?? []).reduce((s, e) => s + (e.principal || 0), 0);
}

/** Σ interest accrued across the imported entries (the real cost). */
export function totalInterest(loan) {
  return (loan?.entries ?? []).reduce((s, e) => s + (e.interest || 0), 0);
}

/**
 * Approximate ORIGINAL principal = current outstanding + principal repaid so far
 * (within the imported history). Approximate because the export may not reach
 * loan origination. Returns null if outstanding is unknown.
 */
export function originalPrincipalEstimate(loan) {
  if (loan?.currentBalance == null) return null;
  return loan.currentBalance + totalPrincipalPaid(loan);
}

/** % of principal paid down (0–100), approximate. Null if it can't be derived. */
export function percentPaid(loan) {
  const orig = originalPrincipalEstimate(loan);
  if (!orig || orig <= 0) return null;
  return Math.min(100, Math.max(0, (totalPrincipalPaid(loan) / orig) * 100));
}

/** Most recent installment amount, used as the "next installment" estimate. Null if none. */
export function nextInstallmentEstimate(loan) {
  const installments = (loan?.entries ?? []).filter((e) => e.type === 'installment');
  if (!installments.length) return null;
  return installments[installments.length - 1].amount;
}

/**
 * Declining-balance series for the chart: starting from the estimated original
 * principal, subtract each installment chronologically. Each point also carries
 * that period's interest (for the interest bars). Returns [] if no origin known.
 */
export function balanceSeries(loan) {
  const orig = originalPrincipalEstimate(loan);
  if (orig == null) return [];
  const sorted = [...(loan?.entries ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  let bal = orig;
  const out = [];
  for (const e of sorted) {
    bal -= (e.principal || 0);
    out.push({ date: e.date, balance: Math.max(0, Math.round(bal * 100) / 100), interest: e.interest || 0 });
  }
  return out;
}

/**
 * The interest entries of a loan shaped as DEBIT cost rows for CostContext.importBankCosts.
 * Category 'loan'; principal entries are intentionally omitted.
 */
export function interestCostRows(loan) {
  return (loan?.entries ?? [])
    .filter((e) => e.type === 'interest' && e.interest > 0)
    .map((e) => ({
      date: e.date,
      rawDesc: e.rawDesc || `Loan interest ${loan.name || ''}`.trim(),
      cleanDesc: `Interest — ${loan.name || 'loan'}`,
      branch: null,
      amount: e.interest,
      direction: 'debit',
      category: 'loan',
      _bankTxId: e._bankTxId,
    }));
}

/** Merge two entry lists, de-duplicating by _bankTxId (re-import safe). */
export function mergeEntries(existing = [], incoming = []) {
  const byId = new Map();
  for (const e of existing) byId.set(e._bankTxId, e);
  for (const e of incoming) byId.set(e._bankTxId, e);
  return [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));
}
