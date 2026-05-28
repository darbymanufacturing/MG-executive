// Maps a Salt Edge posted transaction to a draft cost entry.
// Salt Edge transaction shape:
//   { id, made_on, amount, currency_code, description, category,
//     account_id, extra: { payee, payee_information, ... } }

const CATEGORY_RULES = [
  { pattern: /SERVICE|REPAIR|ΣΕΡΒΙΣ|MAINTENANCE|ΣΥΝΤΗΡ/i, category: 'variable'     },
  { pattern: /ΔΕΗ|ΔΕΔΔΗΕ|PPC|ELECTRICITY|ΗΛΕΚΤΡ|ELECTR/i, category: 'fixed'       },
  { pattern: /ΜΙΣΘΩΜ|ΕΝΟΙΚΙ|RENT|LEASE|ΜΙΣΘ/i,             category: 'fixed'       },
  { pattern: /INSURANCE|ΑΣΦΑΛ/i,                             category: 'fixed'       },
  { pattern: /LOAN|ΔΑΝΕΙ|ANNUITY/i,                          category: 'loan'        },
  { pattern: /CREDIT.?CARD|ΠΙΣΤΩΤ/i,                        category: 'credit-card' },
  { pattern: /FUEL|ΒΕΝΖ|PETROL|CHARGING|ΦΟΡΤ/i,             category: 'variable'    },
];

export function inferCategory(tx) {
  const payee = tx.extra?.payee || tx.extra?.payee_information || '';
  const desc  = `${payee} ${tx.description || ''}`.toUpperCase();
  for (const { pattern, category } of CATEGORY_RULES) {
    if (pattern.test(desc)) return category;
  }
  return 'variable';
}

/** Returns true only for outgoing payments (debits have negative amount in Salt Edge) */
export function isDebitTransaction(tx) {
  return (tx.amount ?? 0) < 0;
}

export function mapTransactionToCost(tx) {
  // Salt Edge: negative amount = debit (outgoing payment); credits are skipped by caller
  if ((tx.amount ?? 0) >= 0) return null; // guard: ignore credits/zero-amount transactions
  const amount = Math.abs(tx.amount);
  const name   = tx.extra?.payee || tx.extra?.payee_information || tx.description || 'Bank Transaction';

  return {
    name,
    amount,
    // #212: use local-time date instead of UTC so the date matches the user's timezone
    startDate:  tx.made_on || (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })(),
    frequency:  'one-time',
    category:   inferCategory(tx),
    notes:      tx.description || null,
    _bankTxId:  tx.id,
  };
}
