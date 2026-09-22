/**
 * Tests for the Autopilot intake engine (docs/AUTOMATION_PLAN.md §3).
 *
 * These rules decide what gets written to the books without a human, so they
 * are tested as money math: the owner chose "hold until approved", and the two
 * things that must never regress are (a) ledger/loan items are ALWAYS held and
 * (b) one real-world cost arriving from several sources stays ONE cost.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeIntakeItem,
  matchIntakeItem,
  classifyIntake,
  prepareIntakeItem,
  payeesMatch,
  amountsMatch,
  payeeKey,
  missingForApproval,
} from '../intake.js';

const NOW = new Date('2026-09-22T10:00:00Z');

const walletRaw = (over = {}) => ({
  source: 'wallet',
  sourceRef: 'rec_123',
  kind: 'cost',
  payload: { name: 'Starlink', amount: 40, date: '2026-09-20', category: 'SW subscriptions, Telco charges', ...over },
});

describe('payee + amount matching', () => {
  it('folds case, punctuation and Greek/Latin lookalikes', () => {
    expect(payeesMatch('STARLINK', 'Starlink')).toBe(true);
    expect(payeesMatch('JYSK A.E.', 'JYSK AE')).toBe(true);
    expect(payeesMatch('Starlink', 'Starlink Internet Corinth')).toBe(true);
  });

  it('does not match unrelated payees', () => {
    expect(payeesMatch('Starlink', 'Workadu')).toBe(false);
    expect(payeesMatch('', 'Starlink')).toBe(false);
  });

  it('avoids false positives from very short keys', () => {
    expect(payeesMatch('AB', 'ABCDEFG')).toBe(false);
  });

  it('matches amounts within tolerance but not beyond', () => {
    expect(amountsMatch(40, 40)).toBe(true);
    expect(amountsMatch(40, 40.5)).toBe(true);     // 1.25% — within 2%
    expect(amountsMatch(40, 45)).toBe(false);
    expect(amountsMatch(-40, 40)).toBe(true);      // sign-agnostic
  });

  it('normalizes payee keys', () => {
    expect(payeeKey('  ΣΕΡΒΙΣ  ')).toBe(payeeKey('ΣΕΡΒΙΣ'));
  });
});

describe('normalizeIntakeItem', () => {
  it('produces the canonical shape with a pending status', () => {
    const item = normalizeIntakeItem(walletRaw(), { now: NOW });
    expect(item.status).toBe('pending');
    expect(item.payload.amount).toBe(40);
    expect(item.payload.currency).toBe('EUR');
    expect(item.match).toBeNull();
  });

  it('coerces European decimals and loose dates', () => {
    const item = normalizeIntakeItem(
      { source: 'gmail', sourceRef: 'x', kind: 'cost', payload: { name: 'X', amount: '12,50', date: '2026-09-20T12:00:00Z' } },
      { now: NOW },
    );
    expect(item.payload.amount).toBe(12.5);
    expect(item.payload.date).toBe('2026-09-20');
  });

  it('falls back to safe defaults for unknown source/kind', () => {
    const item = normalizeIntakeItem({ source: 'nope', kind: 'nope', payload: {} }, { now: NOW });
    expect(item.source).toBe('rule');
    expect(item.kind).toBe('cost');
  });
});

describe('matchIntakeItem', () => {
  const costs = [
    { id: 'c1', name: 'Starlink Corinth', amount: 40, startDate: '2026-09-01', frequency: 'monthly' },
    { id: 'c2', name: 'JYSK', amount: 220, startDate: '2026-08-15', frequency: 'one-time' },
    { id: 'c3', name: 'Fuel', amount: 18, startDate: '2026-09-20', frequency: 'one-time', _intakeRef: 'whatsapp:msg_9' },
  ];

  it('matches a recurring bill so the debit ticks it Paid instead of adding a cost', () => {
    const item = normalizeIntakeItem(walletRaw(), { now: NOW });
    const m = matchIntakeItem(item, costs, { now: NOW });
    expect(m.type).toBe('commitment');
    expect(m.targetId).toBe('c1');
  });

  it('matches a later payment of a one-time invoice inside the window', () => {
    const item = normalizeIntakeItem(walletRaw({ name: 'JYSK', amount: 220, date: '2026-09-10', category: 'Furniture' }), { now: NOW });
    const m = matchIntakeItem(item, costs, { now: NOW });
    expect(m.type).toBe('invoice_payment');
    expect(m.targetId).toBe('c2');
  });

  it('does not match a payment far outside the window', () => {
    const item = normalizeIntakeItem(walletRaw({ name: 'JYSK', amount: 220, date: '2027-03-01', category: 'Furniture' }), { now: NOW });
    expect(matchIntakeItem(item, costs, { now: NOW })).toBeNull();
  });

  it('recognises a record already imported from the same source', () => {
    const item = normalizeIntakeItem(
      { source: 'whatsapp', sourceRef: 'msg_9', kind: 'cost', payload: { name: 'Fuel', amount: 18, date: '2026-09-20' } },
      { now: NOW },
    );
    const m = matchIntakeItem(item, costs, { now: NOW });
    expect(m.type).toBe('duplicate');
    expect(m.targetId).toBe('c3');
  });

  it('returns null for a genuinely new cost', () => {
    const item = normalizeIntakeItem(walletRaw({ name: 'New Supplier AE', amount: 77, category: 'Parts' }), { now: NOW });
    expect(matchIntakeItem(item, costs, { now: NOW })).toBeNull();
  });
});

describe('classifyIntake — the owner chose "hold until approved"', () => {
  it('ALWAYS holds owner-ledger items, however confident', () => {
    const item = normalizeIntakeItem({ source: 'whatsapp', sourceRef: 'm1', kind: 'ledger', payload: { name: 'Panos paid fuel', amount: 18, date: '2026-09-20' } }, { now: NOW });
    item.match = { type: 'duplicate', targetId: 'x', score: 1, why: 'dup' };
    expect(classifyIntake(item).decision).toBe('hold');
  });

  it('ALWAYS holds loan payments', () => {
    const item = normalizeIntakeItem({ source: 'wallet', sourceRef: 'm2', kind: 'loan_payment', payload: { name: 'Alpha loan', amount: 400, date: '2026-09-20', category: 'Bank loans' } }, { now: NOW });
    expect(classifyIntake(item).decision).toBe('hold');
  });

  it('auto-commits a Wallet item the owner already categorized', () => {
    const item = normalizeIntakeItem(walletRaw({ name: 'New Supplier', category: 'Parts' }), { now: NOW });
    const res = classifyIntake(item);
    expect(res.decision).toBe('auto');
    expect(res.confidence).toBeGreaterThan(0.8);
  });

  it('holds a Wallet item Wallet itself left uncategorized', () => {
    const item = normalizeIntakeItem(walletRaw({ category: 'Unknown' }), { now: NOW });
    expect(classifyIntake(item).decision).toBe('hold');
  });

  it('holds everything from Wallet when the owner switches trust off', () => {
    const item = normalizeIntakeItem(walletRaw(), { now: NOW });
    expect(classifyIntake(item, { trustWalletCategories: false }).decision).toBe('hold');
  });

  it('holds a first-time supplier invoice but auto-commits a known one', () => {
    const raw = { source: 'mydata', sourceRef: 'MARK1', kind: 'cost', payload: { name: 'ΔΕΒΑΝ ΑΕ', amount: 120, date: '2026-09-18' } };
    const item = normalizeIntakeItem(raw, { now: NOW });
    expect(classifyIntake(item).decision).toBe('hold');
    expect(classifyIntake(item, { knownSuppliers: [payeeKey('ΔΕΒΑΝ ΑΕ')] }).decision).toBe('auto');
  });

  it('holds items with no amount or no payee', () => {
    const noAmount = normalizeIntakeItem(walletRaw({ amount: 0 }), { now: NOW });
    const noName = normalizeIntakeItem(walletRaw({ name: '' }), { now: NOW });
    expect(classifyIntake(noAmount).decision).toBe('hold');
    expect(classifyIntake(noName).decision).toBe('hold');
  });
});

describe('prepareIntakeItem', () => {
  const costs = [{ id: 'c1', name: 'Starlink Corinth', amount: 40, startDate: '2026-09-01', frequency: 'monthly' }];

  it('matches, classifies and marks an auto item in one pass', () => {
    const item = prepareIntakeItem(walletRaw(), costs, { now: NOW });
    expect(item.match.type).toBe('commitment');
    expect(item.status).toBe('auto_committed');
    expect(item.reasons.length).toBeGreaterThan(0);
  });

  it('leaves an unknown payee pending for review', () => {
    const item = prepareIntakeItem(
      { source: 'gmail', sourceRef: 'g1', kind: 'cost', payload: { name: 'Totally New Ltd', amount: 99, date: '2026-09-21' } },
      costs,
      { now: NOW },
    );
    expect(item.status).toBe('pending');
    expect(item.match).toBeNull();
  });
});

describe('missingForApproval — what each record type still needs', () => {
  const base = (kind, payload) => ({ kind, payload: { name: 'X', amount: 10, ...payload } });

  it('expense needs an amount and a category', () => {
    expect(missingForApproval(base('cost', { category: null }))).toBe('Category');
    expect(missingForApproval(base('cost', { category: 'Fuel', amount: 0 }))).toBe('Amount');
    expect(missingForApproval(base('cost', { category: 'Fuel' }))).toBeNull();
  });

  it('a personal payment also needs to know who paid', () => {
    const item = base('ledger', { category: 'Fuel' });
    expect(missingForApproval(item)).toBe('Who paid');
    expect(missingForApproval(item, { ownerUid: 'u1' })).toBeNull();
  });

  it('a repair needs a scooter', () => {
    expect(missingForApproval(base('ticket', { scooterId: '' }))).toBe('Scooter ID');
    expect(missingForApproval(base('ticket', {}), { scooterId: '41735' })).toBeNull();
  });

  it('issues and tasks need only a title', () => {
    expect(missingForApproval(base('issue', { name: '' }))).toBe('Title');
    expect(missingForApproval(base('task', {}))).toBeNull();
  });

  it('refuses unknown kinds instead of pretending to approve them', () => {
    expect(missingForApproval({ kind: 'mystery', payload: {} })).toBe('Unsupported item type');
  });

  it('overrides win over the stored payload', () => {
    const item = base('cost', { category: null });
    expect(missingForApproval(item, { category: 'Parts' })).toBeNull();
  });
});
