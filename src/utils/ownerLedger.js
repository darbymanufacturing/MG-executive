/**
 * FF-1 owner ledger — pure helpers for the director's-loan / shareholder current account.
 *
 * Sign convention: **+ = the company owes the owner**; **− = the owner owes the company**.
 * Each entry stores a positive `amount` (magnitude) + a `type`; the sign is derived from
 * the type. `repayment` is directional (settling either way) and carries a `direction`.
 */
export const LEDGER_ENTRY_TYPES = {
  salary_accrual:       { label: 'Salary accrued',          sign: +1, hint: 'Wages owed to you for the period' },
  salary_payment:       { label: 'Salary paid',             sign: -1, hint: 'The company paid your wages' },
  expense_reimbursable: { label: 'Paid a company cost',     sign: +1, hint: 'You covered a company expense personally' },
  capital_injection:    { label: 'Capital put in',          sign: +1, hint: 'You put cash into the company' },
  drawing:              { label: 'Drawing taken out',       sign: -1, hint: 'You took cash out beyond salary' },
  repayment:            { label: 'Settlement / repayment',  sign: 0,  hint: 'Settling up either way', directional: true },
};

export const LEDGER_TYPE_KEYS = Object.keys(LEDGER_ENTRY_TYPES);

/** Signed € value of one entry (+ company owes you, − you owe the company). */
export function signedAmount(entry) {
  if (!entry) return 0;
  const amt = Number(entry.amount) || 0;
  const def = LEDGER_ENTRY_TYPES[entry.type];
  if (!def) return 0;
  if (def.directional) return amt * (Number(entry.direction) === -1 ? -1 : 1);
  return amt * def.sign;
}

/** ownerUid → running balance (Σ of signed entries). */
export function balancesByOwner(entries = []) {
  const m = {};
  for (const e of entries) {
    if (!e?.ownerUid) continue;
    m[e.ownerUid] = (m[e.ownerUid] ?? 0) + signedAmount(e);
  }
  return m;
}

/** Σ of signed entries for a single owner. */
export function ownerBalance(entries = [], uid) {
  return entries.reduce((s, e) => (e.ownerUid === uid ? s + signedAmount(e) : s), 0);
}
