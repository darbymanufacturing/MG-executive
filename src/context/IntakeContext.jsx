import { createContext, useContext, useMemo, useCallback } from 'react';
import { useOrg } from './OrgContext.jsx';
import { useAuth } from './AuthContext.jsx';
import { useOrgCollection } from '../hooks/useOrgCollection.js';
import { useOrgDoc } from '../hooks/useOrgDoc.js';
import { orgUpdate, orgWrite } from '../hooks/orgWrite.js';
import { useCosts } from './CostContext.jsx';
import { useIssues } from './IssueContext.jsx';
import { useMaintenance } from './MaintenanceContext.jsx';
import { useLoans } from './LoansContext.jsx';
import { resolveCurrentWeek } from '../utils/powWeek.js';
import { INTAKE_STATUSES, missingForApproval } from '../utils/intake.js';
import { settlementPeriodFor } from '../utils/upcomingPayments.js';
import {
  costFromIntake, ledgerFromIntake, issueFromIntake, taskFromIntake, ticketActionFromIntake,
  recurringFromIntake, learnedRuleFromApproval, loanPaymentPlan,
} from '../utils/intakeRecords.js';
import { authedFetch } from '../utils/apiClient.js';

/**
 * IntakeContext — the owner's side of Omni Autopilot (docs/AUTOMATION_PLAN.md).
 *
 * The robots (Wallet / myDATA / Gmail / WhatsApp / the finance rules) write
 * intake items server-side. Anything they were sure about is already committed —
 * with an UNDO here; anything else waits as `pending`, because the owner chose
 * "hold until approved" (2026-09-22).
 *
 * Approving turns an item into a REAL record with the same pure builders the
 * server uses for WhatsApp approvals (src/utils/intakeRecords.js), written
 * through the app's normal org-scoped seams — and at the SAME deterministic ids,
 * so an item approved on screen and again from a chat can never be recorded
 * twice. Each approval of an expense also teaches a supplier rule (visible and
 * editable on Bank Import → Rules). Unknown kinds are refused, never marked done.
 *
 * Mounted inside Loans/Cost/Maintenance/Issue providers (App.jsx) — it needs all four.
 */
const IntakeContext = createContext(null);

const COLLECTION = 'intakeItems';
const MAX_ITEMS = 500;

const iso = () => new Date().toISOString();
const safe = (s) => String(s ?? '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80) || 'x';

export function IntakeProvider({ children }) {
  const { orgId } = useOrg();
  const { user } = useAuth();
  const { items, loading, error } = useOrgCollection(COLLECTION, { limit: MAX_ITEMS });
  const { items: users } = useOrgCollection('users', {});
  const { item: autopilot } = useOrgDoc('config', orgId ? `${orgId}_autopilot` : null);
  const { costs, deleteCost, setCostSettlement } = useCosts();
  const { createIssue } = useIssues();
  const { addTicket, completeTicket, receiveParts, tickets, parts, scooters } = useMaintenance();
  const { loans, updateLoan } = useLoans();

  /** Newest first; the queue is read far more often than it is written. */
  const all = useMemo(() => {
    const list = (items || []).map((data) => ({ ...data, _docId: data._docId }));
    list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return list;
  }, [items]);

  const pending = useMemo(() => all.filter((i) => i.status === 'pending'), [all]);

  const recentlyHandled = useMemo(
    () => all.filter((i) => i.status && i.status !== 'pending').slice(0, 50),
    [all],
  );

  /** Counts per source, for the queue header. */
  const bySource = useMemo(() => {
    const out = {};
    for (const item of pending) out[item.source] = (out[item.source] || 0) + 1;
    return out;
  }, [pending]);

  /** People who can be owed money in the owner ledger (FF-1). */
  const owners = useMemo(
    () => (users || []).filter((u) => u.isOwner || u.role === 'owner'),
    [users],
  );

  const patchItem = useCallback(async (docId, patch) => {
    await orgUpdate(COLLECTION, docId, { ...patch, updatedAt: iso() }, {
      rethrow: true, errorMessage: 'Failed to update the intake item',
    });
  }, []);

  /** The same deterministic id the server uses for a record made from this item. */
  const recordId = useCallback(
    (kind, item) => `${orgId}_intake_${kind}_${item.source}_${safe(item.sourceRef)}`,
    [orgId],
  );

  /* ── one committer per kind (mirrors api/_lib/intake-commit.js) ────────── */

  const writeCost = useCallback(async (kind, item, doc) => {
    if (!orgId) throw new Error('No active organization');
    const id = recordId(kind, item);
    await orgWrite('costs', { ...doc, id: crypto.randomUUID(), createdAt: iso(), updatedAt: iso() }, {
      id, rethrow: true, errorMessage: 'Failed to save the cost',
    });
    return id;
  }, [orgId, recordId]);

  const committers = useMemo(() => ({
    cost: (item, p) => writeCost('cost', item, costFromIntake(item, p)),

    /* Owner money: "I paid it personally" books the cost AND what the company now
     * owes; a salary accrual / payment / capital-in is ledger-only. */
    ledger: async (item, p) => {
      const type = p.ledgerType || 'expense_reimbursable';
      const costId = type === 'expense_reimbursable' ? await writeCost('cost', item, costFromIntake(item, p)) : null;
      const owner = owners.find((o) => o._docId === p.ownerUid);
      const id = recordId('ledger', item);
      await orgWrite('ownerLedger', ledgerFromIntake(item, p, { ownerName: owner?.displayName ?? null, costId }), {
        id, rethrow: true, errorMessage: 'Failed to add the ledger entry',
      });
      return costId || id;
    },

    issue: async (item, p) => {
      const created = await createIssue(issueFromIntake(item, p));
      return created?.id || created?._docId || null;
    },

    /* A fault opens a ticket; a "done" report CLOSES the scooter's open ticket
     * (costed + destocked through completeTicket's shared plan). */
    ticket: async (item, p) => {
      const action = ticketActionFromIntake(item, p, { tickets, parts, scooters });
      if (action.action === 'complete') {
        await completeTicket(action.ticket._docId, action.details);
        return action.ticket._docId;
      }
      return addTicket(action.data);
    },

    /* POW task — PowContext.addTask's shape (PowProvider is page-scoped). */
    task: async (item, p) => {
      if (!orgId) throw new Error('No active organization');
      const id = `${orgId}_task-${safe(`${item.source}_${item.sourceRef}`)}`;
      await orgWrite('pow_tasks', taskFromIntake(item, p, { week: resolveCurrentWeek(null).computedWeek }), {
        id, rethrow: true, errorMessage: 'Failed to create the POW task',
      });
      return id;
    },

    recurring: (item, p) => writeCost('recurring', item, recurringFromIntake(item, p)),

    /* Installment: tick the commitment that budgets it, or book the INTEREST
     * as a cost; the principal only lowers the loan balance (FF-2 gotcha #3). */
    loan_payment: async (item, p) => {
      const loan = (loans || []).find((l) => l._docId === p.loanId);
      if (!loan) throw new Error('The loan this payment belongs to no longer exists');
      const plan = loanPaymentPlan(item, p, { loan, costs });
      if (plan.settle) await setCostSettlement(plan.settle.costId, plan.settle.period, 'paid');
      if (plan.interestCost) await writeCost('interest', item, plan.interestCost);
      await updateLoan(loan._docId, plan.loanPatch);
      return loan._docId;
    },

    parts_receipt: async (item, p) => {
      await receiveParts(p.parts || []);
      return (p.parts || []).map((x) => x.partId).join(',') || null;
    },
  }), [
    writeCost, owners, recordId, createIssue, tickets, parts, scooters, completeTicket, addTicket,
    orgId, loans, costs, setCostSettlement, updateLoan, receiveParts,
  ]);

  /** Remember supplier → category (and ΑΦΜ → name) for next time. Never blocks. */
  const learnFrom = useCallback(async (item, p) => {
    const learned = learnedRuleFromApproval(item, p);
    if (!learned || !orgId) return;
    await orgWrite('bankRules', { ...learned.rule, id: `learned-${safe(learned.key)}` }, {
      id: `${orgId}_learnedrule_${safe(learned.key)}`, rethrow: false, silent: true,
    }).catch(() => {});
  }, [orgId]);

  /**
   * Approve one item: write the real record, then mark the item approved.
   * Order matters — if the record write fails, the item stays pending so the
   * owner can retry instead of silently losing it.
   */
  const approve = useCallback(async (item, overrides = {}) => {
    if (!item?._docId) throw new Error('approve: item has no document id');
    const missing = missingForApproval(item, overrides);
    if (missing) throw new Error(`Can't approve yet — missing: ${missing}`);

    const commit = committers[item.kind];
    if (!commit) throw new Error(`Unsupported item type: ${item.kind}`);

    const payload = { ...item.payload, ...overrides };
    const committedRef = await commit(item, payload);
    await learnFrom(item, payload);

    await patchItem(item._docId, {
      status: 'approved',
      payload,
      committedRef: committedRef ?? null,
      decidedAt: iso(),
      decidedBy: user?.uid ?? null,
      decidedVia: 'app',
    });
    return committedRef;
  }, [committers, learnFrom, patchItem, user]);

  const reject = useCallback(async (item, reason = null) => {
    if (!item?._docId) throw new Error('reject: item has no document id');
    await patchItem(item._docId, {
      status: 'rejected',
      rejectionReason: reason,
      decidedAt: iso(),
      decidedBy: user?.uid ?? null,
      decidedVia: 'app',
    });
  }, [patchItem, user]);

  /**
   * "Same payment" on a possible duplicate: keep ONE record. When the item is
   * the bank debit for an invoice/receipt already in the books, that record's
   * month is ticked paid (ADR-0027) instead of adding a second cost.
   */
  const merge = useCallback(async (item) => {
    const targetId = item?.match?.targetId;
    if (!item?._docId || !targetId) throw new Error('Nothing to merge with');
    const target = (costs || []).find((c) => c.id === targetId || c._docId === targetId);
    if (target && item.source === 'wallet') {
      const period = settlementPeriodFor(target, item.payload?.date);
      if (period) await setCostSettlement(target.id, period, 'paid');
    }
    await patchItem(item._docId, {
      status: 'merged',
      committedRef: targetId,
      decidedAt: iso(),
      decidedBy: user?.uid ?? null,
      decidedVia: 'app',
    });
  }, [costs, setCostSettlement, patchItem, user]);

  /**
   * Undo an automatic decision (spec §3.3: "auto-commit, with undo"): remove the
   * cost it created, or un-tick the payment it marked — only what Autopilot
   * itself wrote — and put the item back in the queue. It then waits for the
   * owner: the next sync never re-commits it on its own.
   */
  const undo = useCallback(async (item) => {
    if (!item?._docId) throw new Error('undo: item has no document id');
    if (item.status === 'auto_committed') {
      const ref = item.committedRef;
      const target = (costs || []).find((c) => c.id === ref || c._docId === ref);
      const settled = item.settledPeriod || item.match?.period;
      if ((item.match?.type === 'commitment' || item.match?.type === 'invoice_payment') && settled) {
        if (target?.settlements?.[settled]?.by === 'autopilot') await setCostSettlement(target.id, settled, null);
      } else if (target) {
        await deleteCost(target.id);
      }
    } else if (item.status !== 'merged') {
      throw new Error('Only automatic entries can be undone');
    }
    await patchItem(item._docId, {
      status: 'pending',
      noAuto: true,
      committedRef: null,
      reasons: ['You undid the automatic entry — waiting for your call'],
      undoneAt: iso(),
      undoneBy: user?.uid ?? null,
    });
  }, [costs, setCostSettlement, deleteCost, patchItem, user]);

  /** Approve several at once — the "✅ all" path, sequential so one failure stops nothing else. */
  const approveMany = useCallback(async (list) => {
    const results = { approved: 0, failed: [] };
    for (const entry of list) {
      const { item, overrides } = entry?.item ? entry : { item: entry, overrides: {} };
      try {
        await approve(item, overrides);
        results.approved += 1;
      } catch (err) {
        results.failed.push({ id: item?._docId, error: err?.message || String(err) });
      }
    }
    return results;
  }, [approve]);

  /**
   * Run a feed now (or back-fill from a date): 'wallet' | 'mydata' | 'finance'.
   * Same endpoints the nightly cron calls; the server checks this user belongs
   * to the org.
   */
  const syncNow = useCallback(async (feed, { from } = {}) => {
    const path = feed === 'finance' ? '/api/cron-finance' : `/api/intake-${feed}`;
    const res = await authedFetch(`${path}${from ? `?from=${encodeURIComponent(from)}` : ''}`, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Sync failed (${res.status})`);
    return json;
  }, []);

  const value = useMemo(() => ({
    all, pending, recentlyHandled, bySource, owners,
    autopilot: autopilot || {},
    loading,
    // A missing table (migration not applied yet) must not break the app: the
    // queue simply reads empty and the page explains why.
    error: error ? error.message : null,
    approve, approveMany, reject, merge, undo, syncNow,
    STATUSES: INTAKE_STATUSES,
  }), [all, pending, recentlyHandled, bySource, owners, autopilot, loading, error,
    approve, approveMany, reject, merge, undo, syncNow]);

  return <IntakeContext.Provider value={value}>{children}</IntakeContext.Provider>;
}

export const useIntake = () => {
  const ctx = useContext(IntakeContext);
  if (!ctx) throw new Error('useIntake must be used inside IntakeProvider');
  return ctx;
};
