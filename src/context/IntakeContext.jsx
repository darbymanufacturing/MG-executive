import { createContext, useContext, useMemo, useCallback } from 'react';
import { useOrg } from './OrgContext.jsx';
import { useOrgCollection } from '../hooks/useOrgCollection.js';
import { orgUpdate, orgWrite } from '../hooks/orgWrite.js';
import { useCosts } from './CostContext.jsx';
import { useIssues } from './IssueContext.jsx';
import { useMaintenance } from './MaintenanceContext.jsx';
import { resolveCurrentWeek } from './PowContext.jsx';
import { INTAKE_STATUSES, missingForApproval } from '../utils/intake.js';
import { openTicketForScooter, matchPartsByName } from '../utils/maintenanceAutomation.js';

/**
 * IntakeContext — the owner's side of Omni Autopilot (docs/AUTOMATION_PLAN.md).
 *
 * The robots (Wallet / myDATA / Gmail / WhatsApp ingest endpoints) write intake
 * items server-side with the service-role key. Anything they were sure about is
 * already committed; anything else waits here as `pending`, because the owner
 * chose "hold until approved" (2026-09-22).
 *
 * Approving turns an item into a REAL record through the app's normal client
 * seams — `addCost`, `createIssue`, `addTicket`, `orgWrite` — so an approved row
 * is indistinguishable from one typed by hand: same validation, same org
 * stamping, same audit trail. Every kind the WhatsApp router can produce is
 * handled; an unknown kind is refused rather than silently marked approved
 * (which would have lost the record — the bug this version fixes).
 *
 * Mounted INSIDE Issue/Maintenance providers (App.jsx) because it needs both.
 */
const IntakeContext = createContext(null);

const COLLECTION = 'intakeItems';
const MAX_ITEMS = 500;

const todayISO = () => new Date().toISOString().slice(0, 10);

export function IntakeProvider({ children }) {
  const { orgId } = useOrg();
  const { items, loading, error } = useOrgCollection(COLLECTION, { limit: MAX_ITEMS });
  const { items: users } = useOrgCollection('users', {});
  const { addCost } = useCosts();
  const { createIssue } = useIssues();
  const { addTicket, completeTicket, tickets, parts, scooters } = useMaintenance();

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
    await orgUpdate(COLLECTION, docId, {
      ...patch,
      updatedAt: new Date().toISOString(),
    }, { rethrow: true, errorMessage: 'Failed to update the intake item' });
  }, []);

  /* ── one committer per kind ─────────────────────────────────────────── */

  const commitCostRecord = useCallback(async (item, p) => {
    const created = await addCost({
      name: p.name,
      amount: Number(p.amount) || 0,
      category: p.category || 'Unknown',
      frequency: 'one-time',
      startDate: p.date || todayISO(),
      notes: p.notes || null,
      vatIncluded: p.vatAmount != null ? true : undefined,
      vatAmount: p.vatAmount != null ? Number(p.vatAmount) : undefined,
      source: `autopilot-${item.source}`,
      _intakeRef: `${item.source}:${item.sourceRef}`,
      // The original receipt/invoice, kept for VAT audits and the accountant pack.
      receiptUrl: item.evidence?.fileUrl || undefined,
    });
    return created?.id || null;
  }, [addCost]);

  const committers = useMemo(() => ({
    cost: (item, p) => commitCostRecord(item, p),

    /* "I paid a company cost with my own card": the company still incurred the
     * cost (so it goes in the books), AND the company now owes that owner. */
    ledger: async (item, p) => {
      const costId = await commitCostRecord(item, p);
      const owner = owners.find((o) => o._docId === p.ownerUid);
      await orgWrite('ownerLedger', {
        ownerUid: p.ownerUid,
        ownerName: owner?.displayName ?? null,
        type: 'expense_reimbursable',
        amount: Number(p.amount) || 0,
        date: p.date || todayISO(),
        note: [p.name, p.notes].filter(Boolean).join(' — ') || 'Captured by Autopilot',
        linkedCostId: costId,
        source: `autopilot-${item.source}`,
      }, { rethrow: true, errorMessage: 'Failed to add the ledger entry' });
      return costId;
    },

    issue: async (item, p) => {
      const created = await createIssue({
        title: p.name,
        description: [p.notes, item.evidence?.transcript].filter(Boolean).join('\n\n'),
        type: 'other',
        urgency: 'medium',
        nextAction: p.nextAction || '',
        source: `autopilot-${item.source}`,
      });
      return created?.id || created?._docId || null;
    },

    /* A fault report opens a ticket. A "done" report CLOSES the scooter's open
     * ticket — costed and stock-deducted through completeTicket, the same path
     * as an admin completion — instead of opening a duplicate. Only when nothing
     * is open does it record an already-completed ticket. */
    ticket: async (item, p) => {
      const scooterId = String(p.scooterId).trim();
      const scooter = (scooters || []).find((s) => String(s.scooterId) === scooterId);
      const done = Boolean(p.completed);
      const { matched, unmatched } = matchPartsByName(p.parts || [], parts || []);
      const notes = [
        p.notes,
        unmatched.length ? `Parts (not in catalog): ${unmatched.join(', ')}` : null,
        p.minutes ? `Labour: ${p.minutes} min` : null,
        item.evidence?.transcript ? `Voice note: “${item.evidence.transcript}”` : null,
      ].filter(Boolean).join('\n');

      if (done) {
        const open = openTicketForScooter(tickets || [], scooterId);
        if (open) {
          await completeTicket(open._docId, {
            labourMinutes: p.minutes || 0,
            partsUsed: matched,
            note: notes || null,
          });
          return open._docId;
        }
      }

      return addTicket({
        scooterId,
        city: scooter?.city || '',
        dateEntered: p.date || todayISO(),
        dateCompleted: done ? (p.date || todayISO()) : null,
        category: 'M',
        status: done ? 'Completed' : 'Backlog',
        primaryTag: 'WhatsApp',
        issueDescription: p.name,
        notes,
        labourMinutes: p.minutes ?? null,
        partsUsed: [],
        partsUsedText: (p.parts || []).join(', '),
        source: `autopilot-${item.source}`,
      });
    },

    /* POW task — same document shape PowContext.addTask writes (it can't be
     * called here: PowProvider is page-scoped, see Pow.jsx). */
    task: async (item, p) => {
      if (!orgId) throw new Error('No active organization');
      const id = `${orgId}_task-${crypto.randomUUID()}`;
      await orgWrite('pow_tasks', {
        title: p.name,
        description: [p.notes, item.evidence?.transcript].filter(Boolean).join('\n\n'),
        steps: [],
        categoryId: null,
        assignees: [],
        checkedSteps: [],
        powSteps: {},
        status: 'backlog',
        createdWeek: resolveCurrentWeek(null).computedWeek,
        doneWeek: null,
        source: `autopilot-${item.source}`,
      }, { id, rethrow: true, errorMessage: 'Failed to create the POW task' });
      return id;
    },
  }), [commitCostRecord, owners, createIssue, scooters, parts, tickets, addTicket, completeTicket, orgId]);

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

    await patchItem(item._docId, {
      status: 'approved',
      payload,
      committedRef: committedRef ?? null,
      decidedAt: new Date().toISOString(),
    });
    return committedRef;
  }, [committers, patchItem]);

  const reject = useCallback(async (item, reason = null) => {
    if (!item?._docId) throw new Error('reject: item has no document id');
    await patchItem(item._docId, {
      status: 'rejected',
      rejectionReason: reason,
      decidedAt: new Date().toISOString(),
    });
  }, [patchItem]);

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

  const value = useMemo(() => ({
    all, pending, recentlyHandled, bySource, owners,
    loading,
    // A missing table (migration not applied yet) must not break the app: the
    // queue simply reads empty and the page explains why.
    error: error ? error.message : null,
    approve, approveMany, reject,
    STATUSES: INTAKE_STATUSES,
  }), [all, pending, recentlyHandled, bySource, owners, loading, error, approve, approveMany, reject]);

  return <IntakeContext.Provider value={value}>{children}</IntakeContext.Provider>;
}

export const useIntake = () => {
  const ctx = useContext(IntakeContext);
  if (!ctx) throw new Error('useIntake must be used inside IntakeProvider');
  return ctx;
};
