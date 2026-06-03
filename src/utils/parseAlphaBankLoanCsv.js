/**
 * parseAlphaBankLoanCsv — FF-2 Phase C: Alpha Bank LOAN-export parser.
 *
 * The loan feed (FUTURE_FEATURES §FF-2-B) differs from the account feed:
 *   - title `Κινήσεις Δανείου: <loan no.>`; preamble balance = OUTSTANDING owed.
 *   - columns reordered; the sign is **inline** in `Ποσό (EUR)` (e.g. "395,76 Π")
 *     — there is NO separate Πρόσημο column.
 *   - two row types:
 *       ΚΑΤ.ΕΝΑΝΤΙ ΔΟΣΗΣ/ΤΟΚ  = installment paid → principal paydown (Π)
 *       ΕΚΤΟΚΙΣΜΟΣ ΕΝΗΜΕΡΟΥ   = interest accrued  → a real P&L cost (Χ)
 *   - one feed per loan number → the module is multi-loan.
 *
 * Reuses the shared `;`/`="…"`/comma-decimal helpers from parseAlphaBankCsv.
 * Returns { feedType:'loan', loanNumber, name, currentBalance, entries[],
 *           totalPrincipalPaid, totalInterest, dateRange, errors }.
 */
import { splitRow, parseGreekDate, parseGreekDecimal } from './parseAlphaBankCsv.js';

const RE_INTEREST = /ΕΚΤΟΚΙΣΜ/i;       // ΕΚΤΟΚΙΣΜΟΣ ΕΝΗΜΕΡΟΥ → interest accrual
const RE_INSTALLMENT = /ΔΟΣ|ΕΝΑΝΤΙ/i;  // ΚΑΤ.ΕΝΑΝΤΙ ΔΟΣΗΣ/ΤΟΚ → installment

const ALIASES = {
  date:   ['ημερομηνία'],
  desc:   ['αιτιολογία'],
  amount: ['ποσό (eur)', 'ποσό'],
  txnId:  ['αρ. συναλλαγής', 'αρ.συναλλαγής', 'αριθμός συναλλαγής'],
};

function resolveCol(headers, aliases) {
  const low = headers.map((h) => h.toLowerCase().replace(/\s+/g, ' ').trim());
  for (const a of aliases) { const i = low.indexOf(a); if (i !== -1) return i; }
  return -1;
}

function classify(desc) {
  if (RE_INTEREST.test(desc)) return 'interest';
  if (RE_INSTALLMENT.test(desc)) return 'installment';
  return 'other';
}

export function parseAlphaBankLoanCsv(csvText) {
  let text = String(csvText ?? '');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.split(/\r\n|\r|\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());

  const base = {
    feedType: 'loan', loanNumber: null, name: null, currentBalance: null,
    entries: [], totalPrincipalPaid: 0, totalInterest: 0,
    dateRange: { from: null, to: null }, errors: [],
  };
  if (!lines.length) return { ...base, errors: ['The file is empty.'] };

  // header row
  let headerIdx = -1;
  let headers = [];
  for (let i = 0; i < lines.length; i++) {
    const cells = splitRow(lines[i]).map((c) => c.toLowerCase());
    if (cells.some((c) => c.includes('ημερομηνία')) && cells.some((c) => c.includes('αιτιολογία'))) {
      headerIdx = i; headers = splitRow(lines[i]); break;
    }
  }
  if (headerIdx === -1) return { ...base, errors: ['Could not find the loan transaction table header. Is this an Alpha Bank loan CSV?'] };

  const preamble = lines.slice(0, headerIdx);
  // loan number from the title line
  for (const line of preamble) {
    const m = line.match(/Δανείου\s*[:：]?\s*([0-9A-Za-z.\-/]+)/i);
    if (m) { base.loanNumber = m[1].replace(/[^0-9A-Za-z]/g, ''); break; }
  }
  // outstanding balance from a preamble line mentioning υπόλοιπο (may be dot-decimal)
  for (const line of preamble) {
    if (line.toLowerCase().includes('υπόλοιπο')) { base.currentBalance = parseGreekDecimal(line.split(/[:：]/).pop()); break; }
  }

  const col = {
    date:   resolveCol(headers, ALIASES.date),
    desc:   resolveCol(headers, ALIASES.desc),
    amount: resolveCol(headers, ALIASES.amount),
    txnId:  resolveCol(headers, ALIASES.txnId),
  };

  const entries = [];
  const errors = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = splitRow(lines[i]);
    const date = parseGreekDate(cells[col.date]);
    if (!date) { if (cells.some((c) => c.trim())) errors.push(`Row ${i + 1}: could not read a date — skipped.`); continue; }
    const rawDesc = cells[col.desc] || '';
    const amount = parseGreekDecimal(cells[col.amount]); // strips the inline Χ/Π sign
    const type = classify(rawDesc);
    const txnId = (cells[col.txnId] || '').replace(/[="]/g, '').trim();
    const _bankTxId = `alphaloan_${base.loanNumber || 'x'}_${txnId || `${date}_${amount}`}`;
    entries.push({
      date, rawDesc, txnId: txnId || null, _bankTxId, type, amount,
      principal: type === 'installment' ? amount : 0,
      interest: type === 'interest' ? amount : 0,
    });
  }

  entries.sort((a, b) => a.date.localeCompare(b.date));
  const totalPrincipalPaid = entries.reduce((s, e) => s + e.principal, 0);
  const totalInterest = entries.reduce((s, e) => s + e.interest, 0);
  const dates = entries.map((e) => e.date);
  const last4 = (base.loanNumber || '').slice(-4);

  return {
    ...base,
    name: base.loanNumber ? `Loan ••${last4}` : 'Loan',
    entries,
    totalPrincipalPaid,
    totalInterest,
    dateRange: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
    errors,
  };
}
