import { describe, it, expect } from 'vitest';
import { parseAlphaBankCsv, parseGreekDecimal, reconcile } from '../parseAlphaBankCsv.js';

// Account export: preamble (4 lines) + header + 3 data rows.
// Balances chosen so the rows reconcile: net = +1234.56 (credit) − 50 − 80 (debits) = 1104.56;
// closing − opening = 6104.56 − 5000 = 1104.56.
const ACCOUNT_CSV = [
  'Κινήσεις Λογαριασμού: GR1601400000000000000000269',
  'Ημερομηνία εξαγωγής: 01/06/2026',
  'Προηγούμενο λογιστικό υπόλοιπο: 5.000,00',
  'Νέο λογιστικό υπόλοιπο: 6.104,56',
  'Α/Α;Ημερομηνία;Αιτιολογία;Κατάστημα;Τοκισμός από;Αρ. συναλλαγής;Ποσό;Πρόσημο ποσού',
  '="1";="02/05/2026";="ΑΝΤΗRΟΡΙC";="99";="02/05/2026";="12345";="50,00";="Χ"',
  '="2";="03/05/2026";="ΗΟΡΡ ΕΗF.";="949";="03/05/2026";="12346";="1.234,56";="Π"',
  '="3";="04/05/2026";="ΣΕΡΒΙΣ ΜΟΤΟ";="99";="04/05/2026";="12347";="80,00";="Χ"',
].join('\n');

const LOAN_CSV = [
  'Κινήσεις Δανείου: 0000000040004',
  'Υπόλοιπο: 16184.16',
  'Α/Α;Ημερομηνία;Αιτιολογία;Κατάστημα;Ποσό (EUR);Τοκισμός από;Αρ. συναλλαγής',
  '="1";="05/05/2026";="ΚΑΤ.ΕΝΑΝΤΙ ΔΟΣΗΣ/ΤΟΚ";="99";="395,76 Π";="05/05/2026";="55501"',
].join('\n');

describe('parseGreekDecimal', () => {
  it('parses EU comma-decimal with thousands dots', () => {
    expect(parseGreekDecimal('1.234,56')).toBe(1234.56);
    expect(parseGreekDecimal('50,00')).toBe(50);
  });
  it('tolerates dot-decimal balance lines and €/spaces/quotes', () => {
    expect(parseGreekDecimal('16184.16')).toBe(16184.16);
    expect(parseGreekDecimal('="50,00"')).toBe(50);
  });
  it('strips a trailing inline sign letter', () => {
    expect(parseGreekDecimal('395,76 Π')).toBe(395.76);
  });
  it('returns 0 for blank/dash', () => {
    expect(parseGreekDecimal('-')).toBe(0);
    expect(parseGreekDecimal('')).toBe(0);
  });
});

describe('parseAlphaBankCsv — account feed', () => {
  const res = parseAlphaBankCsv(ACCOUNT_CSV);

  it('detects the account feed and parses all rows past the preamble', () => {
    expect(res.feedType).toBe('account');
    expect(res.rowCount).toBe(3);
    expect(res.errors).toHaveLength(0);
  });

  it('parses dates, amounts and Χ/Π direction', () => {
    expect(res.rows[0]).toMatchObject({ date: '2026-05-02', amount: 50, direction: 'debit' });
    expect(res.rows[1]).toMatchObject({ date: '2026-05-03', amount: 1234.56, direction: 'credit' });
    expect(res.rows[2]).toMatchObject({ date: '2026-05-04', amount: 80, direction: 'debit' });
  });

  it('cleans Greek-mangled merchant names for display', () => {
    expect(res.rows[0].cleanDesc).toBe('ANTHROPIC');
    expect(res.rows[1].cleanDesc).toBe('HOPP EHF.');
    expect(res.rows[2].cleanDesc).toBe('ΣΕΡΒΙΣ ΜΟΤΟ'); // genuine Greek preserved
  });

  it('auto-categorizes rows via the built-in rules (ADR-0026 category keys)', () => {
    expect(res.rows[0]).toMatchObject({ category: 'Operations & computing services', matched: true }); // ANTHROPIC
    expect(res.rows[2]).toMatchObject({ category: 'Repairs & maintenance', matched: true });           // ΣΕΡΒΙΣ ΜΟΤΟ
  });

  it('uses the bank transaction id as the dedup key', () => {
    expect(res.rows[0]._bankTxId).toBe('alphabank_12345');
  });

  it('extracts balances and date range', () => {
    expect(res.openingBalance).toBe(5000);
    expect(res.closingBalance).toBe(6104.56);
    expect(res.dateRange).toEqual({ from: '2026-05-02', to: '2026-05-04' });
  });

  it('reconciles rows to the statement balance change', () => {
    const rec = reconcile(res);
    expect(rec).not.toBeNull();
    expect(rec.ok).toBe(true);
    expect(rec.net).toBeCloseTo(1104.56, 2);
  });
});

describe('parseAlphaBankCsv — loan feed detection', () => {
  it('detects a loan export and defers to the Loans importer', () => {
    const res = parseAlphaBankCsv(LOAN_CSV);
    expect(res.feedType).toBe('loan');
    expect(res.rows).toHaveLength(0);
    expect(res.errors[0]).toMatch(/loan/i);
  });
});

describe('parseAlphaBankCsv — fallback dedup key (no txnId)', () => {
  // Two identical rows (same date, same desc, same amount) with an empty txn-id column.
  // They must produce distinct _bankTxId values so neither is silently dropped as a duplicate.
  const NO_TXNID_CSV = [
    'Κινήσεις Λογαριασμού: GR1601400000000000000000269',
    'Προηγούμενο λογιστικό υπόλοιπο: 5.000,00',
    'Νέο λογιστικό υπόλοιπο: 4.900,00',
    'Α/Α;Ημερομηνία;Αιτιολογία;Κατάστημα;Τοκισμός από;Αρ. συναλλαγής;Ποσό;Πρόσημο ποσού',
    '="1";="02/05/2026";="ΣΕΡΒΙΣ ΜΟΤΟ";="99";="02/05/2026";="";="50,00";="Χ"',
    '="2";="02/05/2026";="ΣΕΡΒΙΣ ΜΟΤΟ";="99";="02/05/2026";="";="50,00";="Χ"',
  ].join('\n');

  it('assigns distinct _bankTxId values when txnId is empty and rows share date/desc/amount', () => {
    const res = parseAlphaBankCsv(NO_TXNID_CSV);
    expect(res.rowCount).toBe(2);
    const [id0, id1] = res.rows.map((r) => r._bankTxId);
    expect(id0).not.toBe(id1);
  });

  it('includes the row index tiebreaker in the fallback key', () => {
    const res = parseAlphaBankCsv(NO_TXNID_CSV);
    // headerIdx is 3 (0-based), so data rows are at loop index i=4 and i=5
    expect(res.rows[0]._bankTxId).toBe('alphabank_2026-05-02_ΣΕΡΒΙΣ_ΜΟΤΟ_50_r4');
    expect(res.rows[1]._bankTxId).toBe('alphabank_2026-05-02_ΣΕΡΒΙΣ_ΜΟΤΟ_50_r5');
  });

  it('re-importing the same file produces the same keys (deterministic)', () => {
    const res1 = parseAlphaBankCsv(NO_TXNID_CSV);
    const res2 = parseAlphaBankCsv(NO_TXNID_CSV);
    expect(res1.rows[0]._bankTxId).toBe(res2.rows[0]._bankTxId);
    expect(res1.rows[1]._bankTxId).toBe(res2.rows[1]._bankTxId);
  });
});

describe('parseAlphaBankCsv — bad input', () => {
  it('returns a friendly error when no header is found', () => {
    const res = parseAlphaBankCsv('just;some;garbage\n1;2;3');
    expect(res.feedType).toBe('unknown');
    expect(res.errors[0]).toMatch(/header/i);
  });
  it('handles empty input', () => {
    expect(parseAlphaBankCsv('').errors[0]).toMatch(/empty/i);
  });
});
