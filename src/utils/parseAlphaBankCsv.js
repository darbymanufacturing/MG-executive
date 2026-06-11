/**
 * parseAlphaBankCsv — FF-2 Alpha Bank (Greece) ACCOUNT-export parser.
 *
 * Format (FUTURE_FEATURES §FF-2-A, from two real samples 2026-06-01):
 *   - `;`-delimited, decimal **comma** (`1.234,56`), text cells wrapped `="…"`,
 *     Greek headers, a multi-line preamble before the table.
 *   - Columns: Α/Α · Ημερομηνία (DD/MM/YYYY) · Αιτιολογία (desc) · Κατάστημα (branch)
 *     · Τοκισμός από (value date) · Αρ. συναλλαγής (txn id — dedup key) · Ποσό
 *     · Πρόσημο ποσού (Χ = debit/expense, Π = credit/income).
 *   - A SEPARATE sign column (unlike the loan export, where the sign is inline).
 *
 * Returns { feedType, rows, openingBalance, closingBalance, dateRange, rowCount, errors }.
 * Loan exports are detected and returned with feedType:'loan' + rows:[] (Phase C owns
 * the loan parser). Bad rows are surfaced in `errors`, never silently dropped.
 */
import { cleanMerchantName } from './normalizeGreekLatin.js';
import { inferCategoryFromText } from './bankRulesEngine.js';

const HEADER_ALIASES = {
  date:    ['ημερομηνία'],
  desc:    ['αιτιολογία'],
  branch:  ['κατάστημα'],
  txnId:   ['αρ. συναλλαγής', 'αρ.συναλλαγής', 'αριθμός συναλλαγής'],
  amount:  ['ποσό', 'ποσό (eur)'],
  sign:    ['πρόσημο ποσού', 'πρόσημο'],
};

const GREEK_DEBIT = 'Χ';  // U+03A7 — money out
const GREEK_CREDIT = 'Π'; // U+03A0 — money in

/** Split a `;`-delimited Alpha row, unwrapping `="…"` cells (`;` inside quotes is literal). */
export function splitRow(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '=' && line[i + 1] === '"') continue;   // drop the = before an opening quote
    if (ch === '"') { inQ = !inQ; continue; }           // drop quote chars, toggle state
    if (ch === ';' && !inQ) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** "08/04/2026" → "2026-04-08"; null if unparseable. */
export function parseGreekDate(raw) {
  const s = String(raw ?? '').replace(/[="]/g, '').trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** "1.234,56" → 1234.56 (EU comma-decimal); also tolerates dot-decimal balance lines. */
export function parseGreekDecimal(raw) {
  let s = String(raw ?? '').replace(/[="€\s]/g, '').trim();
  // strip a trailing inline sign letter if present (defensive; account feed uses a column)
  s = s.replace(/[ΧΠ]$/u, '');
  if (!s || s === '-') return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); // EU: dots=thousands, comma=decimal
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}

function resolveCol(headers, aliases) {
  const low = headers.map((h) => h.toLowerCase().replace(/\s+/g, ' ').trim());
  for (const a of aliases) {
    const i = low.indexOf(a);
    if (i !== -1) return i;
  }
  return -1;
}

/** Best-effort opening/closing balance from the preamble (advisory reconciliation cue). */
function extractBalances(preambleLines) {
  let openingBalance = null;
  let closingBalance = null;
  for (const line of preambleLines) {
    const low = line.toLowerCase();
    if (!low.includes('υπόλοιπο')) continue;
    const val = parseGreekDecimal(line.split(':').pop());
    if (low.includes('νέο') || low.includes('νεο')) closingBalance = val;
    else if (low.includes('προηγ')) openingBalance = val;
  }
  return { openingBalance, closingBalance };
}

export function parseAlphaBankCsv(csvText) {
  let text = String(csvText ?? '');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
  const lines = text.split(/\r\n|\r|\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());

  const empty = {
    feedType: 'unknown', rows: [], openingBalance: null, closingBalance: null,
    dateRange: { from: null, to: null }, rowCount: 0, errors: [],
  };
  if (!lines.length) return { ...empty, errors: ['The file is empty.'] };

  // Find the header row (first line that contains both Ημερομηνία and Αιτιολογία).
  let headerIdx = -1;
  let headers = [];
  for (let i = 0; i < lines.length; i++) {
    const cells = splitRow(lines[i]).map((c) => c.toLowerCase());
    if (cells.some((c) => c.includes('ημερομηνία')) && cells.some((c) => c.includes('αιτιολογία'))) {
      headerIdx = i;
      headers = splitRow(lines[i]);
      break;
    }
  }
  if (headerIdx === -1) {
    return { ...empty, errors: ['Could not find the transaction table header (Ημερομηνία / Αιτιολογία). Is this an Alpha Bank CSV export?'] };
  }

  const preamble = lines.slice(0, headerIdx);
  const { openingBalance, closingBalance } = extractBalances(preamble);

  const col = {
    date:   resolveCol(headers, HEADER_ALIASES.date),
    desc:   resolveCol(headers, HEADER_ALIASES.desc),
    branch: resolveCol(headers, HEADER_ALIASES.branch),
    txnId:  resolveCol(headers, HEADER_ALIASES.txnId),
    amount: resolveCol(headers, HEADER_ALIASES.amount),
    sign:   resolveCol(headers, HEADER_ALIASES.sign),
  };

  // Feed detection: a separate Πρόσημο (sign) column ⇒ account feed; otherwise loan feed.
  const titleLine = (preamble.join(' ')).toLowerCase();
  const isLoan = col.sign === -1 || titleLine.includes('κινήσεις δανείου');
  if (isLoan) {
    return {
      ...empty,
      feedType: 'loan',
      openingBalance, closingBalance,
      errors: ['This looks like a loan export — import it from the Loans page.'],
    };
  }

  const rows = [];
  const errors = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = splitRow(lines[i]);
    const date = parseGreekDate(cells[col.date]);
    if (!date) {
      // skip the preamble-style trailer lines silently, but surface anything that looks like data
      if (cells.some((c) => c.trim())) errors.push(`Row ${i + 1}: could not read a date — skipped.`);
      continue;
    }
    const rawDesc = cells[col.desc] || '';
    const signCell = (cells[col.sign] || '').replace(/[="]/g, '').trim();
    const direction = signCell === GREEK_DEBIT ? 'debit'
      : signCell === GREEK_CREDIT ? 'credit'
        : 'debit'; // default unknown sign to debit so it surfaces in the cost review
    const amount = parseGreekDecimal(cells[col.amount]);
    const txnId = (cells[col.txnId] || '').replace(/[="]/g, '').trim();
    const _bankTxId = txnId
      ? `alphabank_${txnId}`
      : `alphabank_${date}_${rawDesc.slice(0, 16).replace(/\s+/g, '_')}_${amount}_r${i}`;
    const { category, matched } = inferCategoryFromText(rawDesc);

    rows.push({
      date,
      rawDesc,
      cleanDesc: cleanMerchantName(rawDesc),
      branch: cells[col.branch] || null,
      txnId: txnId || null,
      amount,
      direction,
      category,
      matched,
      _bankTxId,
    });
  }

  const dates = rows.map((r) => r.date).sort();
  return {
    feedType: 'account',
    rows,
    openingBalance,
    closingBalance,
    dateRange: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
    rowCount: rows.length,
    errors,
  };
}

/**
 * Advisory reconciliation: do the parsed rows' net movement match the statement's
 * balance change? Returns null when balances couldn't be read from the preamble.
 */
export function reconcile({ rows, openingBalance, closingBalance }) {
  if (openingBalance == null || closingBalance == null) return null;
  const net = rows.reduce(
    (sum, r) => sum + (r.direction === 'credit' ? r.amount : -r.amount),
    0,
  );
  const expected = closingBalance - openingBalance;
  const diff = Math.round((expected - net) * 100) / 100;
  return { ok: Math.abs(diff) < 0.01, net, expected, diff };
}
