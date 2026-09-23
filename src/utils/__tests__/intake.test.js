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
  canonicalCategory,
  applyLearnedRules,
} from '../intake.js';
import { settlementPeriodFor } from '../upcomingPayments.js';

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

  it('holds a first-time supplier invoice but auto-commits a known one — WITH its category', () => {
    const raw = { source: 'mydata', sourceRef: 'MARK1', kind: 'cost', payload: { name: 'ΔΕΒΑΝ ΑΕ', amount: 120, date: '2026-09-18' } };
    expect(prepareIntakeItem(raw, [], { now: NOW }).status).toBe('pending');

    const history = [{ id: 'old', name: 'ΔΕΒΑΝ ΑΕ', amount: 90, startDate: '2026-06-02', frequency: 'one-time', category: 'Parts' }];
    const known = prepareIntakeItem(raw, history, { now: NOW });
    expect(known.status).toBe('auto_committed');
    expect(known.payload.category).toBe('Parts');
  });

  it('never auto-commits money without a real category, even from a "known" supplier', () => {
    const item = normalizeIntakeItem({ source: 'mydata', sourceRef: 'M2', kind: 'cost', payload: { name: 'ΔΕΒΑΝ ΑΕ', amount: 120, date: '2026-09-18' } }, { now: NOW });
    expect(classifyIntake(item, { knownSuppliers: [payeeKey('ΔΕΒΑΝ ΑΕ')] }).decision).toBe('hold');
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

describe('canonicalCategory — only real category keys reach a cost', () => {
  it('keeps Omni/Wallet names and maps labels case-insensitively', () => {
    expect(canonicalCategory('Space rent')).toBe('Space rent');
    expect(canonicalCategory('space RENT')).toBe('Space rent');
    expect(canonicalCategory('Parts')).toBe('Parts');
  });
  it('maps plain-language guesses through the keyword rules', () => {
    expect(canonicalCategory('Petrol')).toBe('Fuel');
    expect(canonicalCategory('Office rent')).toBe('Space rent');
  });
  it('turns every flavour of "we do not know" into null', () => {
    for (const g of [null, '', 'Unknown', 'Unknown expense', 'Uncategorized', 'Others', 'Office knick-knacks']) {
      expect(canonicalCategory(g)).toBeNull();
    }
  });
  it('normalizeIntakeItem keeps the original guess beside the canonical key', () => {
    const item = normalizeIntakeItem({ source: 'gmail', sourceRef: 'g', kind: 'cost', payload: { name: 'BP', amount: 5, category: 'Petrol' } }, { now: NOW });
    expect(item.payload.category).toBe('Fuel');
    expect(item.payload.categoryGuess).toBe('Petrol');
  });
});

describe('applyLearnedRules — what earlier decisions taught', () => {
  const item = (payload, source = 'mydata') => normalizeIntakeItem({ source, sourceRef: 's', kind: 'cost', payload: { amount: 50, date: '2026-09-20', ...payload } }, { now: NOW });

  it('names and categorizes a myDATA invoice by the supplier ΑΦΜ', () => {
    const rules = [{ learned: true, vatNumber: '094014201', supplierName: 'JYSK', category: 'Space & Equipment', contains: 'JYSK' }];
    const prepared = prepareIntakeItem({ source: 'mydata', sourceRef: 'M9', kind: 'cost', payload: { name: 'ΑΦΜ 094014201', counterpartVat: '094014201', amount: 124, date: '2026-09-18' } }, [], { now: NOW, rules });
    expect(prepared.payload.name).toBe('JYSK');
    expect(prepared.payload.category).toBe('Space & Equipment');
    expect(prepared.status).toBe('auto_committed');
  });

  it('matches a learned payee through spelling noise', () => {
    const rules = [{ learned: true, contains: 'JYSK A.E.', supplierName: 'JYSK A.E.', category: 'Space & Equipment' }];
    expect(applyLearnedRules(item({ name: 'JYSK AE' }, 'gmail'), { rules }).category).toBe('Space & Equipment');
  });

  it("applies the owner's own keyword rules, in priority order", () => {
    const rules = [
      { contains: 'VODAFONE', category: 'SW subscriptions, Telco charges', priority: 2 },
      { contains: 'VODA', category: 'Other admin expenses', priority: 1 },
    ];
    expect(applyLearnedRules(item({ name: 'Vodafone Greece' }, 'gmail'), { rules }).category).toBe('Other admin expenses');
  });

  it('falls back to the latest categorized cost from the same payee', () => {
    const costs = [
      { name: 'Skroutz', category: 'Consumables', startDate: '2026-01-10' },
      { name: 'SKROUTZ', category: 'Equipment and Tools', startDate: '2026-08-10' },
    ];
    expect(applyLearnedRules(item({ name: 'Skroutz' }, 'gmail'), { costs }).category).toBe('Equipment and Tools');
  });

  it('never uses the built-in keyword guesses — a guess must not auto-commit money', () => {
    expect(applyLearnedRules(item({ name: 'SHELL ΚΟΡΙΝΘΟΣ' }, 'gmail'), {})).toBeNull();
  });
});

describe('settlements are keyed by the OCCURRENCE month (#705)', () => {
  it('rent due 31 Aug and debited 1 Sep ticks August', () => {
    const rent = { id: 'rent', name: 'Landlord', amount: 350, frequency: 'monthly', startDate: '2026-01-31' };
    expect(settlementPeriodFor(rent, '2026-09-01')).toBe('2026-08');
  });
  it('an invoice dated 12 Aug paid on 5 Sep ticks August', () => {
    const inv = { id: 'i', name: 'JYSK', amount: 124, frequency: 'one-time', startDate: '2026-08-12' };
    expect(settlementPeriodFor(inv, '2026-09-05')).toBe('2026-08');
  });
  it('picks the occurrence due nearest the payment — late or a little early', () => {
    const bill = { id: 'b', name: 'Starlink', amount: 40, frequency: 'monthly', startDate: '2026-01-05' };
    expect(settlementPeriodFor(bill, '2026-09-06')).toBe('2026-09'); // a day late
    expect(settlementPeriodFor(bill, '2026-09-02')).toBe('2026-09'); // three days early
    expect(settlementPeriodFor(bill, '2026-09-19')).toBe('2026-09'); // two weeks late, still nearer September
  });
  it('returns null when that occurrence was already ticked by hand — the debit is not a second payment', () => {
    const bill = { id: 'b', name: 'Starlink', amount: 40, frequency: 'monthly', startDate: '2026-01-05', settlements: { '2026-09': { status: 'paid' } } };
    expect(settlementPeriodFor(bill, '2026-09-06')).toBeNull();
  });
  it('the matcher carries the period, and an already-ticked month merges instead of double-counting', () => {
    const rent = { id: 'rent', name: 'Landlord', amount: 350, frequency: 'monthly', startDate: '2026-01-31' };
    const debit = normalizeIntakeItem(walletRaw({ name: 'LANDLORD', amount: 350, date: '2026-09-01', category: 'Space rent' }), { now: NOW });
    expect(matchIntakeItem(debit, [rent], { now: NOW })).toMatchObject({ type: 'commitment', period: '2026-08' });
    const ticked = { ...rent, settlements: { '2026-08': { status: 'paid' }, '2026-09': { status: 'paid' } } };
    expect(matchIntakeItem(debit, [ticked], { now: NOW }).type).toBe('duplicate');
  });
});

describe('one real cost, many sightings', () => {
  it('a receipt photo and the card debit for the same money are held as a possible duplicate — never merged on amount alone', () => {
    const photo = { id: 'p', name: 'Fuel', amount: 18, startDate: '2026-09-20', frequency: 'one-time', source: 'autopilot-whatsapp', category: 'Fuel' };
    const debit = prepareIntakeItem(walletRaw({ name: 'BP ΚΟΡΙΝΘ', amount: 18, date: '2026-09-21', category: 'Fuel' }), [photo], { now: NOW });
    expect(debit.match.type).toBe('possible_duplicate');
    expect(debit.status).toBe('pending');
  });
  it('two bank debits of the same amount are two payments, not a duplicate', () => {
    const earlier = { id: 'd1', name: 'BP', amount: 50, startDate: '2026-09-19', frequency: 'one-time', source: 'autopilot-wallet' };
    const debit = normalizeIntakeItem(walletRaw({ name: 'SHELL', amount: 50, date: '2026-09-20', category: 'Fuel' }), { now: NOW });
    expect(matchIntakeItem(debit, [earlier], { now: NOW })).toBeNull();
  });
  it('an emailed BILL for a recurring commitment never ticks it paid — only the bank debit can', () => {
    const starlink = { id: 'c1', name: 'Starlink Corinth', amount: 40, startDate: '2026-09-01', frequency: 'monthly' };
    const bill = normalizeIntakeItem({ source: 'gmail', sourceRef: 'g', kind: 'cost', payload: { name: 'Starlink', amount: 40, date: '2026-09-20', category: 'SW subscriptions, Telco charges' } }, { now: NOW });
    expect(matchIntakeItem(bill, [starlink], { now: NOW }).type).toBe('possible_duplicate');
  });
});

describe('undo and the new record kinds', () => {
  it('an item the owner undid is held, whatever the source says', () => {
    const item = prepareIntakeItem(walletRaw({ name: 'New Supplier', category: 'Parts' }), [], { now: NOW, noAuto: true });
    expect(item.status).toBe('pending');
    expect(item.reasons[0]).toMatch(/undid/);
  });
  it('a standing-commitment suggestion is always held', () => {
    const item = normalizeIntakeItem({ source: 'rule', sourceRef: 'r', kind: 'recurring', payload: { name: 'Vodafone', amount: 40, category: 'SW subscriptions, Telco charges' } }, { now: NOW });
    expect(classifyIntake(item).decision).toBe('hold');
  });
  it('a loan payment needs its loan and a split that adds up', () => {
    const loan = { kind: 'loan_payment', payload: { name: 'Alpha', amount: 500, loanId: 'l1', interest: 120, principal: 380 } };
    expect(missingForApproval(loan)).toBeNull();
    expect(missingForApproval(loan, { principal: 300 })).toBe('Interest / principal split');
    expect(missingForApproval(loan, { loanId: '' })).toBe('Loan');
  });
  it('a salary accrual is not a cost, so it needs no category', () => {
    const accrual = { kind: 'ledger', payload: { name: 'Salary', amount: 1500, ownerUid: 'u1', ledgerType: 'salary_accrual' } };
    expect(missingForApproval(accrual)).toBeNull();
  });
  it('a parts delivery needs at least one catalogued part with a quantity', () => {
    expect(missingForApproval({ kind: 'parts_receipt', payload: { parts: [] } })).toBe('Parts');
    expect(missingForApproval({ kind: 'parts_receipt', payload: { parts: [{ partId: 'p1', qty: 4 }] } })).toBeNull();
  });
});
