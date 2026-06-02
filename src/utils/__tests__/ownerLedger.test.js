import { describe, it, expect } from 'vitest';
import {
  signedAmount, balancesByOwner, ownerBalance, LEDGER_ENTRY_TYPES, LEDGER_TYPE_KEYS,
} from '../ownerLedger.js';

describe('FF-1 owner ledger helpers', () => {
  it('signs each entry type per the +/- convention (+ = company owes you)', () => {
    expect(signedAmount({ type: 'salary_accrual', amount: 1000 })).toBe(1000);
    expect(signedAmount({ type: 'salary_payment', amount: 1000 })).toBe(-1000);
    expect(signedAmount({ type: 'expense_reimbursable', amount: 50 })).toBe(50);
    expect(signedAmount({ type: 'capital_injection', amount: 5000 })).toBe(5000);
    expect(signedAmount({ type: 'drawing', amount: 200 })).toBe(-200);
  });

  it('repayment is directional (+ company→you, − you→company; defaults +)', () => {
    expect(signedAmount({ type: 'repayment', amount: 300, direction: 1 })).toBe(300);
    expect(signedAmount({ type: 'repayment', amount: 300, direction: -1 })).toBe(-300);
    expect(signedAmount({ type: 'repayment', amount: 300 })).toBe(300);
  });

  it('unknown/empty entries contribute 0', () => {
    expect(signedAmount({ type: 'nope', amount: 99 })).toBe(0);
    expect(signedAmount(null)).toBe(0);
    expect(signedAmount({ type: 'salary_accrual' })).toBe(0); // no amount
  });

  it('balancesByOwner + ownerBalance sum signed entries per owner', () => {
    const entries = [
      { ownerUid: 'a', type: 'salary_accrual', amount: 2000 },
      { ownerUid: 'a', type: 'salary_payment', amount: 1500 },
      { ownerUid: 'b', type: 'capital_injection', amount: 5000 },
      { ownerUid: 'a', type: 'drawing', amount: 300 },
      { type: 'salary_accrual', amount: 999 }, // no ownerUid → ignored
    ];
    const b = balancesByOwner(entries);
    expect(b.a).toBe(200); // +2000 −1500 −300
    expect(b.b).toBe(5000);
    expect(ownerBalance(entries, 'a')).toBe(200);
    expect(ownerBalance(entries, 'nobody')).toBe(0);
  });

  it('every declared type has a numeric sign or is directional', () => {
    expect(LEDGER_TYPE_KEYS.length).toBeGreaterThanOrEqual(6);
    for (const def of Object.values(LEDGER_ENTRY_TYPES)) {
      expect(def.directional === true || typeof def.sign === 'number').toBe(true);
    }
  });
});
