/**
 * Autopilot completion (2026-09-23) — the rules added when auditing Phases 0–4
 * against docs/AUTOMATION_PLAN.md:
 *   intakeRecords       one record shape for app + WhatsApp approvals; learned rules; loans
 *   maintenance planner one completion plan (cost, stock, schedule, scooter); stock-in
 *   financeRules        recurring bills, salary accruals, owner counterparties
 *   vatPosition         output − input VAT per quarter
 *   revenueImport       the in-app and "send it to Omni" CSV paths agree
 */
import { describe, it, expect } from 'vitest';
import {
  costFromIntake, ledgerFromIntake, taskFromIntake, ticketActionFromIntake, recurringFromIntake,
  learnedRuleFromApproval, splitInstallment, loanForDebit, loanPaymentPlan, loanPaymentRaw,
} from '../intakeRecords.js';
import {
  planTicketCompletion, ticketDocIdFor, scheduleDonePatch, stockAfterReceipt, partStatusAfter,
} from '../maintenanceAutomation.js';
import { detectRecurringBills, salaryAccrualsDue, ownerForCounterparty } from '../financeRules.js';
import { vatPositionByQuarter } from '../vatPosition.js';
import {
  prepareRevenueRows, locationForImport, fleetIdForCity, revenueDocIdFor,
} from '../revenueImport.js';

const item = (over = {}) => ({ source: 'whatsapp', sourceRef: 'wamid.1', kind: 'cost', payload: {}, evidence: {}, ...over });

describe('intakeRecords — one record shape for every approval path', () => {
  it('a cost carries a real category key, VAT, supplier ΑΦΜ, MARK and receipt', () => {
    const c = costFromIntake(
      item({ source: 'mydata', sourceRef: 'M1', evidence: { mydataMark: '4001', fileUrl: 'https://x/y.pdf' } }),
      { name: 'JYSK', amount: 124.004, category: 'Petrol', date: '2026-09-18', vatAmount: 24, counterpartVat: '094014201' },
    );
    expect(c).toMatchObject({
      name: 'JYSK', amount: 124, category: 'Fuel', frequency: 'one-time', startDate: '2026-09-18',
      vatIncluded: true, vatAmount: 24, supplierVat: '094014201', mydataMark: '4001',
      receiptUrl: 'https://x/y.pdf', source: 'autopilot-mydata', _intakeRef: 'mydata:M1',
    });
  });

  it('a salary accrual is ledger-only; "paid personally" links its cost', () => {
    const accrual = ledgerFromIntake(item(), { name: 'Salary 2026-09', amount: 1500, ownerUid: 'u1', ledgerType: 'salary_accrual', period: '2026-09' });
    expect(accrual).toMatchObject({ type: 'salary_accrual', amount: 1500, period: '2026-09' });
    expect(accrual.linkedCostId).toBeUndefined();
    const paid = ledgerFromIntake(item(), { name: 'Fuel', amount: 18, ownerUid: 'u1' }, { costId: 'c9', ownerName: 'Kostas' });
    expect(paid).toMatchObject({ type: 'expense_reimbursable', linkedCostId: 'c9', ownerName: 'Kostas' });
  });

  it('a task lands in the backlog of the given week', () => {
    expect(taskFromIntake(item(), { name: 'Call the municipality', assignee: 'Panos' }, { week: 47 }))
      .toMatchObject({ title: 'Call the municipality', status: 'backlog', createdWeek: 47, assignees: ['Panos'] });
  });

  it('a "done" repair closes the open ticket; a fault opens one', () => {
    const tickets = [{ _docId: 't1', scooterId: '41735', status: 'Backlog', dateEntered: '2026-09-10' }];
    const parts = [{ _docId: 'p1', partName: 'Brake cable', unitCost: 6 }];
    const done = ticketActionFromIntake(item({ kind: 'ticket' }), { scooterId: '41735', completed: true, minutes: 25, parts: ['brake cable'] }, { tickets, parts });
    expect(done.action).toBe('complete');
    expect(done.ticket._docId).toBe('t1');
    expect(done.details).toMatchObject({ labourMinutes: 25, partsUsed: [{ partId: 'p1', quantity: 1 }] });

    const fault = ticketActionFromIntake(item({ kind: 'ticket' }), { scooterId: '51946', name: 'Brakes squeak' }, { tickets, parts, today: '2026-09-23' });
    expect(fault.action).toBe('create');
    expect(fault.data).toMatchObject({ scooterId: '51946', status: 'Backlog', dateEntered: '2026-09-23', primaryTag: 'WhatsApp' });
  });

  it('a recurring suggestion starts on its NEXT occurrence', () => {
    expect(recurringFromIntake(item({ source: 'rule' }), { name: 'Vodafone', amount: 40, category: 'SW subscriptions, Telco charges', nextDate: '2026-10-05' }))
      .toMatchObject({ frequency: 'monthly', startDate: '2026-10-05', amount: 40 });
  });

  it('an approval teaches ONE rule per supplier — by ΑΦΜ when there is one', () => {
    const byVat = learnedRuleFromApproval(item({ kind: 'cost' }), { name: 'JYSK', category: 'Space & Equipment', counterpartVat: '094014201' });
    expect(byVat.key).toBe('vat-094014201');
    expect(byVat.rule).toMatchObject({ learned: true, vatNumber: '094014201', supplierName: 'JYSK', category: 'Space & Equipment', priority: 500 });
    const byPayee = learnedRuleFromApproval(item({ kind: 'cost' }), { name: 'Skroutz', category: 'Consumables' });
    expect(byPayee.key).toBe('payee-skroutz');
    expect(learnedRuleFromApproval(item({ kind: 'cost' }), { name: 'X', category: null })).toBeNull();
    expect(learnedRuleFromApproval(item({ kind: 'ledger' }), { name: 'Salary', category: 'CEO', ledgerType: 'salary_accrual' })).toBeNull();
  });
});

describe('loans — interest is a cost, principal only lowers the balance', () => {
  const loan = { _docId: 'org_loan_1', name: 'Alpha business loan', lender: 'Alpha Bank', monthlyPayment: 500, currentBalance: 24000, interestRate: 6, entries: [] };

  it('splits an installment from the balance and the annual rate', () => {
    expect(splitInstallment(loan, 500)).toEqual({ interest: 120, principal: 380 }); // 24000 × 6% / 12
    expect(splitInstallment({ ...loan, interestRate: null }, 500)).toBeNull();
  });

  it('recognises the installment debit and re-shapes it as a held loan payment', () => {
    expect(loanForDebit([loan], { name: 'ALPHA BANK ΔΟΣΗ', amount: 500 })).toBe(loan);
    expect(loanForDebit([loan], { name: 'Vodafone', amount: 40 })).toBeUndefined();
    const raw = loanPaymentRaw({ sourceRef: 'r1', kind: 'cost', payload: { name: 'ALPHA BANK', amount: 500, date: '2026-09-05' } }, loan);
    expect(raw).toMatchObject({ kind: 'loan_payment', payload: { loanId: 'org_loan_1', interest: 120, principal: 380 } });
  });

  it('books only the interest when nothing budgets the installment', () => {
    const plan = loanPaymentPlan(item({ source: 'wallet', sourceRef: 'r1' }), { amount: 500, interest: 120, principal: 380, date: '2026-09-05', name: 'ALPHA' }, { loan, costs: [] });
    expect(plan.settle).toBeNull();
    expect(plan.interestCost).toMatchObject({ amount: 120, category: 'Loan Interest' });
    expect(plan.loanPatch.currentBalance).toBe(23620);
    expect(plan.loanPatch.entries).toHaveLength(1);
  });

  it('ticks the commitment that budgets the installment instead of adding a cost', () => {
    const costs = [{ id: 'c1', name: 'Alpha Bank loan', amount: 500, frequency: 'monthly', startDate: '2026-01-05' }];
    const plan = loanPaymentPlan(item({ source: 'wallet' }), { amount: 500, interest: 120, principal: 380, date: '2026-09-05', name: 'ALPHA' }, { loan, costs, now: new Date('2026-09-06T00:00:00Z') });
    expect(plan.settle).toEqual({ costId: 'c1', period: '2026-09' });
    expect(plan.interestCost).toBeNull();
  });

  it('re-approving the same debit never adds a second installment entry', () => {
    const once = loanPaymentPlan(item({ source: 'wallet', sourceRef: 'r1' }), { amount: 500, interest: 120, principal: 380, date: '2026-09-05' }, { loan, costs: [] });
    const twice = loanPaymentPlan(item({ source: 'wallet', sourceRef: 'r1' }), { amount: 500, interest: 120, principal: 380, date: '2026-09-05' }, { loan: { ...loan, entries: once.loanPatch.entries }, costs: [] });
    expect(twice.loanPatch.entries).toHaveLength(1);
  });
});

describe('maintenance — one completion plan, and stock back in', () => {
  const tickets = [
    { _docId: 't1', scooterId: '41735', status: 'Backlog', scheduleId: 's1' },
    { _docId: 't2', scooterId: '51946', status: 'Backlog' },
  ];
  const parts = [{ _docId: 'p1', sku: '2010100184', partName: 'Brake cable', stockOnHand: 3, unitCost: 6 }];
  const schedules = [{ _docId: 's1', recurrence: 'months', interval: 3, nextDue: '2026-09-01', status: 'active' }];
  const scooters = [{ _docId: 'sc1', scooterId: '41735', status: 'In Repair' }];

  it('costs the repair, takes the parts off the shelf, rolls the schedule and frees the scooter', () => {
    const plan = planTicketCompletion({
      ticket: tickets[0], tickets, parts, schedules, scooters, config: { labourRatePerHour: 24 },
      details: { labourMinutes: 30, partsUsed: [{ partId: 'p1', quantity: 1, unitCost: 6 }] }, today: '2026-09-23',
    });
    expect(plan.ticketPatch).toMatchObject({ status: 'Completed', dateCompleted: '2026-09-23', labourCost: 12, totalPartsCost: 6, totalCost: 18, costStatus: 'pending' });
    expect(plan.stock).toEqual([{ docId: 'p1', stockOnHand: 2 }]);
    expect(plan.schedule).toEqual({ docId: 's1', patch: { nextDue: '2026-12-23', lastCompleted: '2026-09-23', status: 'active' } });
    expect(plan.scooter).toEqual({ docId: 'sc1', status: 'Active' });
  });

  it('suffixes a second ticket for the same scooter and day', () => {
    expect(ticketDocIdFor('org', '41735', '2026-09-23', [])).toBe('org_41735_2026-09-23');
    expect(ticketDocIdFor('org', '41735', '2026-09-23', [{ _docId: 'org_41735_2026-09-23' }])).toBe('org_41735_2026-09-23_2');
  });

  it('a one-off schedule is done once serviced', () => {
    expect(scheduleDonePatch({ recurrence: 'none', nextDue: '2026-09-01' }, '2026-09-23')).toEqual({ status: 'done', lastCompleted: '2026-09-23' });
  });

  it('a delivery goes on the shelf, off "on order", and fixes the status', () => {
    const shelf = [{ _docId: 'p1', stockOnHand: 1, unitsOnOrder: 10, reorderPoint: 4, status: 'On Order' }];
    expect(stockAfterReceipt(shelf, [{ partId: 'p1', qty: 10 }])).toEqual([{ docId: 'p1', stockOnHand: 11, unitsOnOrder: 0, status: 'In Stock' }]);
    expect(stockAfterReceipt(shelf, [{ partId: 'p1', qty: 2 }])[0].status).toBe('On Order'); // 8 still coming
    expect(partStatusAfter({ reorderPoint: 4 }, 3)).toBe('Low Stock');
    expect(partStatusAfter({ status: 'Discontinued' }, 50)).toBe('Discontinued');
    expect(stockAfterReceipt(shelf, [{ partId: 'nope', qty: 2 }])).toEqual([]);
  });
});

describe('financeRules', () => {
  const now = new Date('2026-09-23T06:00:00Z');
  const bill = (month, amount, over = {}) => ({ id: `v${month}`, name: 'Vodafone', amount, startDate: `2026-${month}-05`, frequency: 'one-time', category: 'SW subscriptions, Telco charges', ...over });

  it('suggests a standing commitment after three steady months', () => {
    const [s] = detectRecurringBills([bill('06', 40), bill('07', 41), bill('08', 40)], { now });
    expect(s).toMatchObject({ kind: 'recurring', sourceRef: 'recurring_vodafone', payload: { amount: 40, frequency: 'monthly', nextDate: '2026-09-05', category: 'SW subscriptions, Telco charges' } });
  });

  it('stays quiet on a gap, a jumpy amount, a double charge, or an existing commitment', () => {
    expect(detectRecurringBills([bill('06', 40), bill('08', 40)], { now })).toEqual([]);
    expect(detectRecurringBills([bill('06', 40), bill('07', 90), bill('08', 40)], { now })).toEqual([]);
    expect(detectRecurringBills([bill('06', 40), bill('07', 40), bill('07', 40, { id: 'dup' }), bill('08', 40)], { now })).toEqual([]);
    const committed = { id: 'c', name: 'Vodafone GR', amount: 40, frequency: 'monthly', startDate: '2026-01-05' };
    expect(detectRecurringBills([bill('06', 40), bill('07', 40), bill('08', 40), committed], { now })).toEqual([]);
  });

  it('accrues each salaried owner once per month', () => {
    const owners = [{ _docId: 'u1', displayName: 'Kostas M' }, { _docId: 'u2', displayName: 'Panos K' }];
    const due = salaryAccrualsDue(owners, { u1: 1500 }, { now });
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ sourceRef: 'salary_u1_2026-09', kind: 'ledger', payload: { ownerUid: 'u1', amount: 1500, ledgerType: 'salary_accrual', period: '2026-09' } });
  });

  it("recognises an owner by full name only — a shared first name isn't enough", () => {
    const owners = [{ _docId: 'u1', displayName: 'Kostas Marmaras' }];
    expect(ownerForCounterparty(owners, 'MARMARAS KOSTAS')?._docId).toBe('u1');
    expect(ownerForCounterparty(owners, 'Kostas Papadopoulos')).toBeNull();
  });
});

describe('vatPosition — output VAT on revenue minus input VAT on expenses', () => {
  it('nets a quarter and reports coverage and payments', () => {
    const costs = [
      { name: 'JYSK', amount: 124, vatIncluded: true, vatAmount: 24, frequency: 'one-time', startDate: '2026-07-12', category: 'Space & Equipment' },
      { name: 'Fuel', amount: 30, frequency: 'one-time', startDate: '2026-08-02', category: 'Fuel' },
      { name: 'ΦΠΑ Q2', amount: 300, frequency: 'one-time', startDate: '2026-07-25', category: 'VAT' },
    ];
    const revenue = [{ date: '2026-07-10', totalPaidRevenue: 1000 }, { date: '2026-08-10', totalPaidRevenue: 500 }];
    const [, , q3] = vatPositionByQuarter({ costs, revenue, financial: { vatRate: 0.24 }, year: 2026, now: new Date('2026-09-23T00:00:00Z') });
    expect(q3).toMatchObject({ quarter: 'Q3', started: true, output: 360, input: 24, net: 336, paid: 300, coverage: { withVat: 1, count: 2 }, aade: null });
  });

  it("cross-checks against myDATA's own figure when the feed is on", () => {
    const intake = [{ source: 'mydata', payload: { date: '2026-07-12', vatAmount: 30 } }];
    const [, , q3] = vatPositionByQuarter({ costs: [], revenue: [], year: 2026, intake, now: new Date('2026-09-23T00:00:00Z') });
    expect(q3.aade).toBe(30);
  });
});

describe('revenueImport — the in-app and forwarded-file paths agree', () => {
  it('strips VAT only when the owner said the export includes it, and tags the city', () => {
    const rows = [{ date: '2026-09-01', totalPaidRevenue: 124, totalTrips: 10 }];
    expect(prepareRevenueRows(rows, { amountsIncludeVat: true, vatRate: 0.24, location: 'Corinth' })[0])
      .toMatchObject({ totalPaidRevenue: 100, totalTrips: 10, location: 'Corinth' });
    expect(prepareRevenueRows(rows, { amountsIncludeVat: false })[0].totalPaidRevenue).toBe(124);
  });

  it('takes the city from the caption, else the last import', () => {
    const locations = ['Corinth', 'Nafplion'];
    expect(locationForImport({ caption: 'nafplion september', locations, lastLocation: 'Corinth' })).toBe('Nafplion');
    expect(locationForImport({ caption: '', locations, lastLocation: 'Corinth' })).toBe('Corinth');
    expect(locationForImport({ caption: 'Athens', locations })).toBeNull();
  });

  it('stamps the fleet and the same deterministic id as the app', () => {
    expect(fleetIdForCity([{ _docId: 'f1', cities: ['corinth'] }], 'Corinth')).toBe('f1');
    expect(fleetIdForCity([], 'Corinth')).toBeNull();
    expect(revenueDocIdFor('org', { date: '2026-09-01', location: 'Corinth' })).toBe('org_2026-09-01_Corinth');
    expect(revenueDocIdFor('org', { date: '2026-09-01' })).toBe('org_2026-09-01_global');
  });
});

describe('advanceDueDate — timezone-proof (#707)', () => {
  it('lands on the same calendar day whatever the local timezone', async () => {
    const { advanceDueDate } = await import('../maintenanceAutomation.js');
    expect(advanceDueDate('2026-09-23', 'months', 3)).toBe('2026-12-23');
    expect(advanceDueDate('2026-09-23', 'weeks', 2)).toBe('2026-10-07');
    expect(advanceDueDate('2026-12-31', 'days', 1)).toBe('2027-01-01');
    expect(advanceDueDate('2026-03-29', 'days', 1)).toBe('2026-03-30'); // across the EU DST switch
    expect(advanceDueDate('not a date', 'days', 1)).toBe('not a date');
  });
});
