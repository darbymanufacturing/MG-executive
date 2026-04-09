// Maps a GoCardless booked transaction to a draft cost entry.
// GoCardless transaction shape:
//   { transactionId, bookingDate, transactionAmount: { amount, currency },
//     remittanceInformationUnstructured, creditorName, creditorAccount, accountId }

const CATEGORY_RULES = [
  { pattern: /SERVICE|REPAIR|ΣΕΡΒΙΣ|MAINTENANCE|ΣΥΝΤΗΡ/i, category: 'variable' },
  { pattern: /ΔΕΗ|ΔΕΔΔΗΕ|PPC|ELECTRICITY|ΗΛΕΚΤΡ|ELECTR/i, category: 'fixed' },
  { pattern: /ΜΙΣΘΩΜ|ΕΝΟΙΚΙ|RENT|LEASE|ΜΙΣΘ/i,            category: 'fixed' },
  { pattern: /INSURANCE|ΑΣΦΑΛ/i,                             category: 'fixed' },
  { pattern: /LOAN|ΔΑΝΕΙ|ANNUITY/i,                          category: 'loan' },
  { pattern: /CREDIT.?CARD|ΠΙΣΤΩΤ/i,                        category: 'credit-card' },
  { pattern: /FUEL|ΒΕΝΖ|PETROL|CHARGING|ΦΟΡΤ/i,             category: 'variable' },
];

export function inferCategory(tx) {
  const desc = `${tx.creditorName || ''} ${tx.remittanceInformationUnstructured || ''}`.toUpperCase();
  for (const { pattern, category } of CATEGORY_RULES) {
    if (pattern.test(desc)) return category;
  }
  return 'variable';
}

export function mapTransactionToCost(tx) {
  const rawAmount = parseFloat(tx.transactionAmount?.amount ?? '0');
  // Only map outgoing (debit) transactions — negative amounts in GoCardless
  const amount = Math.abs(rawAmount);

  return {
    name: tx.creditorName || tx.remittanceInformationUnstructured || 'Bank Transaction',
    amount,
    startDate: tx.bookingDate || new Date().toISOString().slice(0, 10),
    frequency: 'one-time',
    category: inferCategory(tx),
    notes: tx.remittanceInformationUnstructured || null,
    _bankTxId: tx.transactionId,
  };
}
