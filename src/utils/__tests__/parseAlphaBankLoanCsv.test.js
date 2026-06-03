import { describe, it, expect } from 'vitest';
import { parseAlphaBankLoanCsv } from '../parseAlphaBankLoanCsv.js';

const LOAN_CSV = [
  'Κινήσεις Δανείου: 0000000040004',
  'Νέο υπόλοιπο: 16184.16',
  'Α/Α;Ημερομηνία;Αιτιολογία;Κατάστημα;Ποσό (EUR);Τοκισμός από;Αρ. συναλλαγής',
  '="1";="05/01/2026";="ΚΑΤ.ΕΝΑΝΤΙ ΔΟΣΗΣ/ΤΟΚ";="99";="395,76 Π";="05/01/2026";="55501"',
  '="2";="05/01/2026";="ΕΚΤΟΚΙΣΜΟΣ ΕΝΗΜΕΡΟΥ";="99";="60,24 Χ";="05/01/2026";="55502"',
  '="3";="05/02/2026";="ΚΑΤ.ΕΝΑΝΤΙ ΔΟΣΗΣ/ΤΟΚ";="99";="398,00 Π";="05/02/2026";="55503"',
].join('\n');

describe('parseAlphaBankLoanCsv', () => {
  const res = parseAlphaBankLoanCsv(LOAN_CSV);

  it('detects the loan feed, number, name and outstanding balance', () => {
    expect(res.feedType).toBe('loan');
    expect(res.loanNumber).toBe('0000000040004');
    expect(res.name).toBe('Loan ••0004');
    expect(res.currentBalance).toBe(16184.16); // dot-decimal preamble line
    expect(res.errors).toHaveLength(0);
  });

  it('classifies installment (principal) vs interest rows, sign inline', () => {
    expect(res.entries).toHaveLength(3);
    expect(res.entries[0]).toMatchObject({ type: 'installment', principal: 395.76, interest: 0 });
    expect(res.entries[1]).toMatchObject({ type: 'interest', principal: 0, interest: 60.24 });
    expect(res.entries[2]).toMatchObject({ type: 'installment', principal: 398, interest: 0 });
  });

  it('totals principal vs interest and namespaces the dedup key by loan', () => {
    expect(res.totalPrincipalPaid).toBeCloseTo(793.76, 2);
    expect(res.totalInterest).toBeCloseTo(60.24, 2);
    expect(res.entries[0]._bankTxId).toBe('alphaloan_0000000040004_55501');
    expect(res.dateRange).toEqual({ from: '2026-01-05', to: '2026-02-05' });
  });
});
