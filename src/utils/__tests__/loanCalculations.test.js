import { describe, it, expect } from 'vitest';
import {
  totalPrincipalPaid,
  totalInterest,
  originalPrincipalEstimate,
  percentPaid,
  nextInstallmentEstimate,
  balanceSeries,
  interestCostRows,
  mergeEntries,
} from '../loanCalculations.js';

const loan = {
  loanNumber: '0000000040004',
  name: 'Loan ••0004',
  currentBalance: 16184.16,
  entries: [
    { date: '2026-01-05', type: 'installment', principal: 395.76, interest: 0, amount: 395.76, _bankTxId: 'a1' },
    { date: '2026-01-05', type: 'interest', principal: 0, interest: 60.24, amount: 60.24, _bankTxId: 'a2', rawDesc: 'ΕΚΤΟΚΙΣΜΟΣ' },
    { date: '2026-02-05', type: 'installment', principal: 398, interest: 0, amount: 398, _bankTxId: 'a3' },
  ],
};

describe('loanCalculations', () => {
  it('totals principal and interest', () => {
    expect(totalPrincipalPaid(loan)).toBeCloseTo(793.76, 2);
    expect(totalInterest(loan)).toBeCloseTo(60.24, 2);
  });

  it('estimates original principal and % paid', () => {
    expect(originalPrincipalEstimate(loan)).toBeCloseTo(16977.92, 2); // 16184.16 + 793.76
    expect(percentPaid(loan)).toBeCloseTo(4.675, 2);
  });

  it('next installment = latest installment amount', () => {
    expect(nextInstallmentEstimate(loan)).toBe(398);
  });

  it('declining balance series ends at the current outstanding', () => {
    const s = balanceSeries(loan);
    expect(s).toHaveLength(3);
    expect(s[s.length - 1].balance).toBeCloseTo(16184.16, 2);
    expect(s[0].balance).toBeCloseTo(16582.16, 2); // 16977.92 - 395.76
  });

  it('interest-only cost rows (principal excluded — no double count)', () => {
    const rows = interestCostRows(loan);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: 60.24, direction: 'debit', category: 'loan', _bankTxId: 'a2' });
  });

  it('mergeEntries dedups by _bankTxId', () => {
    const merged = mergeEntries(loan.entries, [
      { date: '2026-02-05', type: 'installment', principal: 398, interest: 0, amount: 398, _bankTxId: 'a3' }, // dup
      { date: '2026-03-05', type: 'installment', principal: 400, interest: 0, amount: 400, _bankTxId: 'a4' }, // new
    ]);
    expect(merged).toHaveLength(4);
    expect(merged[merged.length - 1]._bankTxId).toBe('a4');
  });

  it('returns null/empty gracefully when outstanding is unknown', () => {
    const unknown = { entries: loan.entries };
    expect(originalPrincipalEstimate(unknown)).toBeNull();
    expect(percentPaid(unknown)).toBeNull();
    expect(balanceSeries(unknown)).toEqual([]);
  });
});
