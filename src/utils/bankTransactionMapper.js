// Maps a Salt Edge posted transaction to a draft cost entry.
// Salt Edge transaction shape:
//   { id, made_on, amount, currency_code, description, category,
//     account_id, extra: { payee, payee_information, ... } }
//
// FF-2: the category rules + matching now live in bankRulesEngine.js (shared with
// the Alpha Bank CSV path). This module keeps the Salt-Edge-shaped adapter only.
import { inferCategoryFromText } from './bankRulesEngine.js';

export function inferCategory(tx) {
  const payee = tx.extra?.payee || tx.extra?.payee_information || '';
  return inferCategoryFromText(`${payee} ${tx.description || ''}`).category;
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
