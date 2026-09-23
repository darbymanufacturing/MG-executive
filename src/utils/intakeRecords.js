/**
 * intakeRecords.js — the REAL records an approved intake item becomes.
 *
 * One definition for both approval paths:
 *   - the app       (IntakeContext → orgWrite/orgUpdate, Review page)
 *   - the server    (api/_lib/intake-commit.js → WhatsApp "✅" approvals)
 * so an item approved from a chat is indistinguishable from one approved on
 * screen: same fields, same category keys, same ledger/loan/stock rules.
 *
 * Pure: builders return plain objects; the callers do the writing.
 */
import { canonicalCategory, payeeKey } from './intake.js';
import { cleanMerchantName } from './normalizeGreekLatin.js';
import { matchPartsByName, openTicketForScooter } from './maintenanceAutomation.js';
import { settlementPeriodFor, isCommitment } from './upcomingPayments.js';
import { payeesMatch, amountsMatch } from './intake.js';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const todayISO = () => new Date().toISOString().slice(0, 10);

/** Where this record came from, for the audit trail on every row. */
export const sourceTag = (item) => `autopilot-${item?.source || 'rule'}`;

/** A one-time cost from an expense (or the cost half of "I paid it personally"). */
export function costFromIntake(item, p) {
  return {
    name: p.name,
    amount: round2(Number(p.amount) || 0),
    category: canonicalCategory(p.category) || 'Unknown',
    frequency: 'one-time',
    startDate: p.date || todayISO(),
    notes: p.notes || null,
    ...(p.vatAmount != null ? { vatIncluded: true, vatAmount: round2(p.vatAmount) } : {}),
    ...(p.counterpartVat ? { supplierVat: String(p.counterpartVat) } : {}),
    ...(item?.evidence?.mydataMark ? { mydataMark: String(item.evidence.mydataMark) } : {}),
    ...(p.projectId ? { projectId: p.projectId } : {}),
    source: sourceTag(item),
    _intakeRef: `${item.source}:${item.sourceRef}`,
    // The original receipt/invoice, kept for VAT audits and the accountant pack.
    ...(item?.evidence?.fileUrl ? { receiptUrl: item.evidence.fileUrl } : {}),
  };
}

/**
 * The owner-ledger entry. "Paid a company cost personally" (the default) links
 * to the cost it created; a salary accrual stands alone — the wage cost itself
 * is booked separately, so the ledger only records what the company now owes.
 */
export function ledgerFromIntake(item, p, { ownerName = null, costId = null } = {}) {
  const type = p.ledgerType || 'expense_reimbursable';
  return {
    ownerUid: p.ownerUid,
    ownerName,
    type,
    amount: round2(Number(p.amount) || 0),
    date: p.date || todayISO(),
    note: [p.name, p.notes].filter(Boolean).join(' — ') || 'Captured by Autopilot',
    ...(costId ? { linkedCostId: costId } : {}),
    ...(p.period ? { period: p.period } : {}),
    source: sourceTag(item),
  };
}

/** Fields an issue gets from an intake item (IssueContext.createIssue adds its own defaults). */
export function issueFromIntake(item, p) {
  return {
    title: p.name,
    description: [p.notes, item?.evidence?.transcript].filter(Boolean).join('\n\n'),
    type: p.issueType || 'other',
    urgency: ['low', 'medium', 'high'].includes(p.urgency) ? p.urgency : 'medium',
    nextAction: p.nextAction || '',
    source: sourceTag(item),
  };
}

/** createIssue's defaults, for writers that can't call the context (the server). */
export const ISSUE_DEFAULTS = Object.freeze({
  title: '',
  description: '',
  type: 'other',
  status: 'new',
  urgency: 'medium',
  visibility: 'admin',
  attachments: [],
  notes: [],
  nextAction: '',
  relatedEntity: null,
  dueDate: null,
  snoozeUntil: null,
});

/** A POW task — the same document shape PowContext.addTask writes. */
export function taskFromIntake(item, p, { week }) {
  return {
    title: p.name,
    description: [p.notes, item?.evidence?.transcript].filter(Boolean).join('\n\n'),
    steps: [],
    categoryId: null,
    assignees: p.assignee ? [p.assignee] : [],
    checkedSteps: [],
    powSteps: {},
    status: 'backlog',
    createdWeek: week,
    doneWeek: null,
    source: sourceTag(item),
  };
}

/**
 * What a repair message does: CLOSE the scooter's open ticket (a "done" report)
 * or OPEN a new one (a fault, or a finished repair with nothing open).
 *
 * @returns {{ action:'complete', ticket, details } | { action:'create', data }}
 */
export function ticketActionFromIntake(item, p, { tickets = [], parts = [], scooters = [], today = todayISO() } = {}) {
  const scooterId = String(p.scooterId || '').trim();
  const scooter = scooters.find((s) => String(s.scooterId) === scooterId);
  const done = Boolean(p.completed);
  const { matched, unmatched } = matchPartsByName(p.parts || [], parts);
  const notes = [
    p.notes,
    unmatched.length ? `Parts (not in catalog): ${unmatched.join(', ')}` : null,
    p.minutes ? `Labour: ${p.minutes} min` : null,
    item?.evidence?.transcript ? `Voice note: “${item.evidence.transcript}”` : null,
  ].filter(Boolean).join('\n');

  if (done) {
    const open = openTicketForScooter(tickets, scooterId);
    if (open) {
      return {
        action: 'complete',
        ticket: open,
        details: { labourMinutes: p.minutes || 0, partsUsed: matched, note: notes || null },
      };
    }
  }

  return {
    action: 'create',
    data: {
      scooterId,
      city: scooter?.city || '',
      dateEntered: p.date || today,
      dateCompleted: done ? (p.date || today) : null,
      category: 'M',
      status: done ? 'Completed' : 'Backlog',
      primaryTag: item?.source === 'whatsapp' ? 'WhatsApp' : 'Autopilot',
      issueDescription: p.name,
      notes,
      labourMinutes: p.minutes ?? null,
      partsUsed: [],
      partsUsedText: (p.parts || []).join(', '),
      source: sourceTag(item),
    },
  };
}

/**
 * A standing commitment suggested by the recurring-bill detector. Starts on the
 * NEXT expected occurrence, so the past months stay the actuals they are.
 */
export function recurringFromIntake(item, p) {
  return {
    name: p.name,
    amount: round2(Number(p.amount) || 0),
    category: canonicalCategory(p.category) || 'Unknown',
    frequency: p.frequency || 'monthly',
    startDate: p.nextDate || p.date || todayISO(),
    notes: p.notes || 'Recurring bill detected by Autopilot',
    source: sourceTag(item),
  };
}

/**
 * The learned rule an approval teaches (FF-2 `bankRules` shape + `learned`).
 * Keyed by the supplier's ΑΦΜ when there is one, else by payee — so approving
 * the same supplier twice updates one rule instead of stacking duplicates.
 *
 * @returns {null | { key: string, rule: object }}
 */
export function learnedRuleFromApproval(item, p) {
  if (!item || !['cost', 'ledger'].includes(item.kind)) return null;
  if (item.kind === 'ledger' && (p.ledgerType || 'expense_reimbursable') !== 'expense_reimbursable') return null;
  const category = canonicalCategory(p.category);
  const name = String(p.name || '').trim();
  if (!category || !name || /^ΑΦΜ\s/.test(name)) {
    // An unnamed myDATA supplier can still teach its ΑΦΜ → category.
    if (!category || !p.counterpartVat) return null;
  }
  const vat = String(p.counterpartVat || '').replace(/\D/g, '');
  const key = vat ? `vat-${vat}` : `payee-${payeeKey(name).replace(/ /g, '-')}`;
  if (key === 'payee-') return null;
  const supplierName = name && !/^ΑΦΜ\s/.test(name) ? cleanMerchantName(name) : null;
  return {
    key,
    rule: {
      learned: true,
      contains: (supplierName || name).toUpperCase(),
      ...(supplierName ? { supplierName } : {}),
      ...(vat ? { vatNumber: vat } : {}),
      category,
      priority: 500, // after the owner's own rules, before the built-in defaults
      learnedFrom: item.source,
    },
  };
}

/**
 * Split a loan installment into interest (a P&L cost) and principal (a balance
 * move, NOT an expense — FF-2 gotcha #3). Interest is one month on the current
 * balance at the loan's annual rate; the rest is principal.
 *
 * @returns {{ interest:number, principal:number } | null}  null when the loan has no rate/balance
 */
export function splitInstallment(loan, amount) {
  // No rate on file is NOT a 0% loan (Number(null) === 0): leave the split to the
  // owner rather than book no interest and knock the whole installment off the balance.
  if (loan?.interestRate == null || loan.interestRate === '') return null;
  const balance = Number(loan?.currentBalance);
  const rate = Number(loan.interestRate);
  const paid = Number(amount);
  if (!(paid > 0) || !(balance > 0) || !(rate >= 0) || !Number.isFinite(rate)) return null;
  const interest = Math.min(paid, round2(balance * (rate / 100) / 12));
  return { interest, principal: round2(paid - interest) };
}

/** Is this bank debit a loan installment? Matches lender/name + the monthly payment (±2%). */
export function loanForDebit(loans = [], payload = {}) {
  return (loans || []).find((l) => l && l.type !== 'credit-card'
    && Number(l.monthlyPayment) > 0
    && amountsMatch(l.monthlyPayment, payload.amount)
    && (payeesMatch(l.lender, payload.name) || payeesMatch(l.name, payload.name)
      || /ΔΑΝΕΙ|LOAN|ΔΟΣΗ/i.test(String(payload.name || ''))));
}

/**
 * Everything approving a loan payment changes:
 *   - if a standing commitment already budgets this installment → tick that
 *     occurrence paid (no new cost: the commitment already counts it)
 *   - otherwise → a cost for the INTEREST only (principal is not an expense)
 *   - the loan gets the installment entry and its balance goes down by the principal
 */
export function loanPaymentPlan(item, p, { loan, costs = [], now = new Date() } = {}) {
  const interest = round2(Number(p.interest) || 0);
  const principal = round2(Number(p.principal) || 0);
  const date = p.date || todayISO();

  const commitment = costs.find((c) => isCommitment(c, { now })
    && amountsMatch(c.amount, p.amount)
    && (payeesMatch(c.name, loan?.lender) || payeesMatch(c.name, loan?.name) || payeesMatch(c.name, p.name)));
  const period = commitment ? settlementPeriodFor(commitment, date) : null;

  const entry = {
    date,
    type: 'installment',
    principal,
    interest,
    amount: round2(Number(p.amount) || 0),
    _bankTxId: `autopilot:${item.source}:${item.sourceRef}`,
    rawDesc: p.name || null,
  };
  const entries = [...(loan?.entries || []).filter((e) => e._bankTxId !== entry._bankTxId), entry]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const balance = loan?.currentBalance != null ? Math.max(0, round2(Number(loan.currentBalance) - principal)) : null;

  return {
    settle: commitment && period ? { costId: commitment.id, period } : null,
    interestCost: commitment ? null : (interest > 0 ? {
      name: `Interest — ${loan?.name || 'loan'}`,
      amount: interest,
      category: 'Loan Interest',
      frequency: 'one-time',
      startDate: date,
      notes: `Installment €${entry.amount} = €${principal} principal + €${interest} interest`,
      source: sourceTag(item),
      _intakeRef: `${item.source}:${item.sourceRef}`,
    } : null),
    loanPatch: { entries, ...(balance != null ? { currentBalance: balance } : {}) },
  };
}

/**
 * Re-shape a bank debit that pays a loan installment into a loan-payment item
 * (always held). The interest/principal split is pre-filled from the loan's
 * rate and balance; with no rate on file it stays blank for the owner to enter.
 */
export function loanPaymentRaw(raw, loan) {
  const split = splitInstallment(loan, raw?.payload?.amount);
  return {
    ...raw,
    kind: 'loan_payment',
    payload: {
      ...raw.payload,
      loanId: loan._docId || loan.id,
      loanName: loan.name || null,
      interest: split?.interest ?? null,
      principal: split?.principal ?? null,
      category: 'Loan Interest',
    },
    evidence: {
      ...(raw.evidence || {}),
      loanMatch: `Matches the monthly payment of "${loan.name || 'loan'}"`,
      ...(split ? {} : { splitNeeded: 'No interest rate on file for this loan' }),
    },
  };
}
