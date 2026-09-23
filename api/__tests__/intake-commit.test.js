/**
 * api/__tests__/intake-commit.test.js — approving the review queue on the server
 * (WhatsApp "✅"). The records must be exactly what the Review page writes, and
 * a re-delivered approval must never record anything twice.
 *
 * Run with:  npx vitest run api/__tests__/intake-commit.test.js
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeSupabase, row, docOf } from './helpers/fakeSupabase.js';

let fake;
vi.mock('../_lib/supabase-admin.js', () => ({ supabaseAdmin: () => fake }));

const { approveOnServer, rejectOnServer, loadCommitContext, pendingIntake } = await import('../_lib/intake-commit.js');

const ORG = 'org1';
const intake = (id, data) => row(ORG, `${ORG}_intake_whatsapp_${id}`, {
  source: 'whatsapp', sourceRef: id, status: 'pending', createdAt: `2026-09-2${id.length}T08:00:00Z`, evidence: {}, ...data,
});

beforeEach(() => {
  fake = fakeSupabase({
    intake_items: [],
    costs: [],
    owner_ledger: [],
    bank_rules: [],
    users: [row(ORG, 'u1', { displayName: 'Kostas Marmaras', role: 'owner' })],
    maintenance_tickets: [row(ORG, `${ORG}_41735_2026-09-10`, { scooterId: '41735', status: 'Backlog', dateEntered: '2026-09-10' })],
    maintenance_parts: [row(ORG, `${ORG}_2010100184`, { partName: 'Brake cable', sku: '2010100184', stockOnHand: 3, unitCost: 6, reorderPoint: 2 })],
    maintenance_schedules: [],
    scooters: [row(ORG, `${ORG}_41735`, { scooterId: '41735', status: 'In Repair' })],
    loans: [row(ORG, `${ORG}_loan_A1`, { name: 'Alpha loan', lender: 'Alpha Bank', monthlyPayment: 500, currentBalance: 24000, interestRate: 6, entries: [] })],
    app_config: [row(ORG, `${ORG}_maintenance`, { labourRatePerHour: 24 })],
  });
});

const approve = async (sdid, overrides = {}) => {
  const data = await loadCommitContext(fake, ORG);
  return approveOnServer(fake, ORG, sdid, overrides, data, { via: 'whatsapp', by: 'whatsapp:Kostas' });
};

describe('approveOnServer', () => {
  it('books an expense at a deterministic id, teaches the supplier rule, and marks the item approved', async () => {
    fake.tables.intake_items.push(intake('m1', { kind: 'cost', payload: { name: 'Skroutz', amount: 42, date: '2026-09-20', category: 'Consumables' } }));
    const ref = await approve(`${ORG}_intake_whatsapp_m1`);
    expect(ref).toBe(`${ORG}_intake_cost_whatsapp_m1`);
    expect(docOf(fake.tables, 'costs', ref)).toMatchObject({ name: 'Skroutz', amount: 42, category: 'Consumables', source: 'autopilot-whatsapp', createdByUid: 'whatsapp:Kostas' });
    expect(docOf(fake.tables, 'bank_rules', `${ORG}_learnedrule_payee-skroutz`)).toMatchObject({ learned: true, category: 'Consumables' });
    expect(docOf(fake.tables, 'intake_items', `${ORG}_intake_whatsapp_m1`)).toMatchObject({ status: 'approved', decidedVia: 'whatsapp', committedRef: ref });
  });

  it('a re-delivered approval is refused and records nothing twice', async () => {
    fake.tables.intake_items.push(intake('m1', { kind: 'cost', payload: { name: 'Skroutz', amount: 42, category: 'Consumables' } }));
    await approve(`${ORG}_intake_whatsapp_m1`);
    await expect(approve(`${ORG}_intake_whatsapp_m1`)).rejects.toThrow(/Already approved/);
    expect(fake.tables.costs).toHaveLength(1);
  });

  it('refuses an item that still misses a detail', async () => {
    fake.tables.intake_items.push(intake('m2', { kind: 'cost', payload: { name: 'ΑΦΜ 0999', amount: 60 } }));
    await expect(approve(`${ORG}_intake_whatsapp_m2`)).rejects.toThrow(/Needs Category/);
    expect(fake.tables.costs).toHaveLength(0);
  });

  it('a salary accrual goes to the owner ledger only — no cost', async () => {
    fake.tables.intake_items.push(intake('s1', { kind: 'ledger', payload: { name: 'Salary 2026-09', amount: 1500, ownerUid: 'u1', ledgerType: 'salary_accrual', period: '2026-09' } }));
    await approve(`${ORG}_intake_whatsapp_s1`);
    expect(fake.tables.costs).toHaveLength(0);
    expect(fake.tables.owner_ledger[0].data).toMatchObject({ type: 'salary_accrual', amount: 1500, ownerName: 'Kostas Marmaras' });
  });

  it('"done" closes the open ticket: costed, parts off the shelf, scooter back to Active', async () => {
    fake.tables.intake_items.push(intake('t1', { kind: 'ticket', payload: { name: 'Brake cable', scooterId: '41735', completed: true, minutes: 30, parts: ['brake cable'] } }));
    await approve(`${ORG}_intake_whatsapp_t1`);
    expect(docOf(fake.tables, 'maintenance_tickets', `${ORG}_41735_2026-09-10`)).toMatchObject({ status: 'Completed', labourCost: 12, totalPartsCost: 6, totalCost: 18, costStatus: 'pending' });
    expect(docOf(fake.tables, 'maintenance_parts', `${ORG}_2010100184`).stockOnHand).toBe(2);
    expect(docOf(fake.tables, 'scooters', `${ORG}_41735`).status).toBe('Active');
  });

  it('two faults on one scooter and day get two tickets, not one overwritten', async () => {
    fake.tables.intake_items.push(
      intake('f1', { kind: 'ticket', payload: { name: 'Brakes', scooterId: '51946', date: '2026-09-23' } }),
      intake('f22', { kind: 'ticket', payload: { name: 'Light', scooterId: '51946', date: '2026-09-23' } }),
    );
    const data = await loadCommitContext(fake, ORG);
    await approveOnServer(fake, ORG, `${ORG}_intake_whatsapp_f1`, {}, data, {});
    await approveOnServer(fake, ORG, `${ORG}_intake_whatsapp_f22`, {}, data, {});
    const ids = fake.tables.maintenance_tickets.map((r) => r.source_doc_id).filter((id) => id.includes('51946'));
    expect(ids.sort()).toEqual([`${ORG}_51946_2026-09-23`, `${ORG}_51946_2026-09-23_2`]);
  });

  it('a loan payment books the interest and lowers the balance by the principal', async () => {
    fake.tables.intake_items.push(intake('l1', { kind: 'loan_payment', payload: { name: 'ALPHA BANK', amount: 500, date: '2026-09-05', loanId: `${ORG}_loan_A1`, interest: 120, principal: 380 } }));
    await approve(`${ORG}_intake_whatsapp_l1`);
    expect(fake.tables.costs[0].data).toMatchObject({ amount: 120, category: 'Loan Interest' });
    expect(docOf(fake.tables, 'loans', `${ORG}_loan_A1`)).toMatchObject({ currentBalance: 23620 });
  });

  it('a parts delivery in words is matched to the catalog and goes on the shelf', async () => {
    fake.tables.intake_items.push(intake('p1', { kind: 'parts_receipt', payload: { name: 'Delivery', partNames: ['10 brake cable'] } }));
    await approve(`${ORG}_intake_whatsapp_p1`);
    expect(docOf(fake.tables, 'maintenance_parts', `${ORG}_2010100184`)).toMatchObject({ stockOnHand: 13, status: 'In Stock' });
  });
});

describe('rejectOnServer and the queue order', () => {
  it('rejects once, and lists the queue oldest first', async () => {
    fake.tables.intake_items.push(
      intake('bbb', { kind: 'cost', payload: { name: 'B', amount: 1 } }),
      intake('a', { kind: 'cost', payload: { name: 'A', amount: 1 } }),
    );
    expect((await pendingIntake(fake, ORG)).map((x) => x.item.payload.name)).toEqual(['A', 'B']);
    await rejectOnServer(fake, ORG, `${ORG}_intake_whatsapp_a`, { reason: 'personal' });
    expect(docOf(fake.tables, 'intake_items', `${ORG}_intake_whatsapp_a`)).toMatchObject({ status: 'rejected', rejectionReason: 'personal' });
    await expect(rejectOnServer(fake, ORG, `${ORG}_intake_whatsapp_a`)).rejects.toThrow(/Already rejected/);
  });
});
