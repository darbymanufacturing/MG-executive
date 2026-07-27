/**
 * loanUiHelpers — pure UI-facing helpers shared by LoanCard / Loans page so a
 * single "loan" doc shape can represent THREE origins without special-casing
 * each one at every call site:
 *   1. CSV-imported bank loans   (LoansContext.upsertLoan)      — no `type` field
 *   2. Manually-added loans      (LoansContext.addLoan, type:'loan')
 *   3. Manually-added credit cards (LoansContext.addLoan, type:'credit-card')
 *
 * Credit cards track a revolving `creditLimit` + utilization; loans track a
 * one-time `principalAmount` + payoff progress. CSV loans predate the `type`/
 * `principalAmount` fields, so payoff progress falls back to the existing
 * entries-derived estimate (loanCalculations.percentPaid) — CSV behavior is
 * unchanged by this module.
 */
import { percentPaid, nextInstallmentEstimate } from '../../utils/loanCalculations.js';

/** 'credit-card' | 'loan'. CSV-imported docs have no `type` field — default 'loan'. */
export function getLoanType(loan) {
  return loan?.type === 'credit-card' ? 'credit-card' : 'loan';
}

export function isCreditCard(loan) {
  return getLoanType(loan) === 'credit-card';
}

/** True once a loan has real transaction history to chart/list (CSV imports, or a
 *  manual entry that's since had a CSV layered onto it). Manual-only debts have none. */
export function hasHistory(loan) {
  return (loan?.entries?.length ?? 0) > 0;
}

/** Credit card utilization as a 0–1 fraction (balance / limit). Null if limit unknown. */
export function getUtilizationFraction(loan) {
  if (!isCreditCard(loan)) return null;
  const limit = loan?.creditLimit;
  if (!limit || limit <= 0) return null;
  const bal = loan?.currentBalance ?? 0;
  return Math.min(1, Math.max(0, bal / limit));
}

/** Utilization band → status token key, thresholds at <30% / <70% / >=70%. */
export function utilizationStatus(fraction) {
  if (fraction == null) return null;
  if (fraction < 0.3) return 'green';
  if (fraction < 0.7) return 'amber';
  return 'red';
}

/**
 * Loan payoff progress (0–100), i.e. 1 − balance/principal. Prefers the manually
 * entered `principalAmount` (accurate original amount); falls back to the
 * CSV-entries-derived estimate so already-imported loans keep working unchanged.
 * Null for credit cards, or when neither principal source is available.
 */
export function getPayoffPct(loan) {
  if (isCreditCard(loan)) return null;
  const principal = loan?.principalAmount;
  if (principal && principal > 0 && loan?.currentBalance != null) {
    return Math.min(100, Math.max(0, (1 - loan.currentBalance / principal) * 100));
  }
  return percentPaid(loan);
}

/** Monthly debt-service amount: explicit field (loans + cards share `monthlyPayment`,
 *  relabeled "Minimum payment" for cards), else the CSV-derived estimate. */
export function getMonthlyAmount(loan) {
  if (loan?.monthlyPayment != null) return loan.monthlyPayment;
  return nextInstallmentEstimate(loan);
}

export function lenderLabel(loan) {
  return isCreditCard(loan) ? 'Issuer' : 'Lender';
}

export function paymentLabel(loan) {
  return isCreditCard(loan) ? 'Minimum payment' : 'Monthly payment';
}

export function principalLabel(loan) {
  return isCreditCard(loan) ? 'Credit limit' : 'Original amount';
}

/** The amount getPrincipalLabel refers to — creditLimit for cards, principalAmount for loans. */
export function getPrincipalValue(loan) {
  return isCreditCard(loan) ? (loan?.creditLimit ?? null) : (loan?.principalAmount ?? null);
}
