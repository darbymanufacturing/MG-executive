/**
 * api/__tests__/intake-store.test.js — ingestBatch, the one door every feed
 * (Wallet, myDATA, email, WhatsApp, finance rules) comes through.
 *
 *   #702 a decision is final: a re-read of the same record never re-opens it
 *   undo   an item the owner undid waits for them instead of re-committing
 *   #705 a bank debit ticks the OCCURRENCE month of the bill it pays
 *   loans an installment debit becomes a held loan payment, not a cost
 *   trust  mail from an untrusted sender is held even for a known supplier
 *
 * Run with:  npx vitest run api/__tests__/intake-store.test.js
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeSupabase, row, docOf } from './helpers/fakeSupabase.js';

let fake;
vi.mock('../_lib/supabase-admin.js', () => ({ supabaseAdmin: () => fake }));

const { ingestBatch, intakeDocId } = await import('../_lib/intake-store.js');

const ORG = 'org1';
const NOW = new Date('2026-09-22T06:00:00Z');
const debit = (id, payload) => ({ sourceRef: id, kind: 'cost', payload: { amount: 40, date: '2026-09-20', ...payload } });

beforeEach(() => {
  fake = fakeSupabase({
    costs: [
      row(ORG, `${ORG}_rent`, { id: 'rent', name: 'Landlord', amount: 350, frequency: 'monthly', startDate: '2026-01-31', category: 'Space rent' }),
      row(ORG, `${ORG}_skroutz`, { id: 'sk', name: 'Skroutz', amount: 30, frequency: 'one-time', startDate: '2026-06-01', category: 'Consumables' }),
    ],
    intake_items: [],
    bank_rules: [],
    loans: [row(ORG, `${ORG}_loan_A1`, { name: 'Alpha loan', lender: 'Alpha Bank', monthlyPayment: 500, currentBalance: 24000, interestRate: 6 })],
    app_config: [],
  });
});

describe('ingestBatch', () => {
  it('#702 — a rejected item stays rejected when the next sync reads it again', async () => {
    const raw = debit('rec_1', { name: 'Personal thing', category: null });
    await ingestBatch([raw], { source: 'wallet', orgId: ORG, now: NOW });
    const sdid = intakeDocId(ORG, 'wallet', 'rec_1');
    docOf(fake.tables, 'intake_items', sdid).status = 'rejected';

    const report = await ingestBatch([raw], { source: 'wallet', orgId: ORG, now: NOW });
    expect(report.alreadyDecided).toBe(1);
    expect(docOf(fake.tables, 'intake_items', sdid).status).toBe('rejected');
  });

  it('an item the owner undid is held on the next sync, not re-committed', async () => {
    const raw = debit('rec_2', { name: 'New Supplier', category: 'Parts' });
    const sdid = intakeDocId(ORG, 'wallet', 'rec_2');
    fake.tables.intake_items.push(row(ORG, sdid, { status: 'pending', noAuto: true, createdAt: '2026-09-20T00:00:00Z' }));
    const report = await ingestBatch([raw], { source: 'wallet', orgId: ORG, now: NOW });
    expect(report.held).toBe(1);
    expect(fake.tables.costs).toHaveLength(2); // nothing new booked
    expect(docOf(fake.tables, 'intake_items', sdid).createdAt).toBe('2026-09-20T00:00:00Z');
  });

  it('#705 — rent debited on 1 Sep ticks the AUGUST occurrence', async () => {
    const report = await ingestBatch([debit('rec_3', { name: 'LANDLORD', amount: 350, date: '2026-09-01', category: 'Space rent' })],
      { source: 'wallet', orgId: ORG, now: NOW });
    expect(report.settled).toBe(1);
    expect(docOf(fake.tables, 'costs', `${ORG}_rent`).settlements).toHaveProperty('2026-08');
  });

  it('an installment debit becomes a held loan payment with the split pre-filled', async () => {
    const report = await ingestBatch([debit('rec_4', { name: 'ALPHA BANK ΔΟΣΗ', amount: 500, category: 'Bank loans' })],
      { source: 'wallet', orgId: ORG, now: NOW });
    expect(report.held).toBe(1);
    expect(docOf(fake.tables, 'intake_items', intakeDocId(ORG, 'wallet', 'rec_4')))
      .toMatchObject({ kind: 'loan_payment', payload: { loanId: `${ORG}_loan_A1`, interest: 120, principal: 380 } });
  });

  it('a known supplier from a trusted source files itself — with its category', async () => {
    const report = await ingestBatch([{ sourceRef: 'g1', kind: 'cost', payload: { name: 'SKROUTZ', amount: 55, date: '2026-09-20' } }],
      { source: 'gmail', orgId: ORG, now: NOW });
    expect(report.auto).toBe(1);
    expect(fake.tables.costs.at(-1).data).toMatchObject({ name: 'SKROUTZ', category: 'Consumables' });
  });

  it('…but mail from an untrusted sender is held, whatever the supplier history says', async () => {
    const report = await ingestBatch([{
      sourceRef: 'g2', kind: 'cost', holdReason: 'Sent by an address that is not on the trusted list',
      payload: { name: 'SKROUTZ', amount: 55, date: '2026-09-20' },
    }], { source: 'gmail', orgId: ORG, now: NOW });
    expect(report.held).toBe(1);
    expect(docOf(fake.tables, 'intake_items', intakeDocId(ORG, 'gmail', 'g2')).reasons[0]).toMatch(/not on the trusted list/);
  });
});
