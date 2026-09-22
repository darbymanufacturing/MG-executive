import { createContext, useContext, useMemo, useCallback } from 'react';
import { useOrgCollection } from '../hooks/useOrgCollection.js';
import { orgUpdate } from '../hooks/orgWrite.js';
import { useCosts } from './CostContext.jsx';
import { INTAKE_STATUSES } from '../utils/intake.js';

/**
 * IntakeContext — the owner's side of Omni Autopilot (docs/AUTOMATION_PLAN.md).
 *
 * The robots (Wallet / myDATA / Gmail / WhatsApp ingest endpoints) write intake
 * items server-side with the service-role key. Anything they were sure about is
 * already committed; anything else waits here as `pending`, because the owner
 * chose "hold until approved" (2026-09-22).
 *
 * This context is deliberately thin: it reads the queue and turns an approval
 * into a REAL write through the normal client seams (`addCost` → `orgWrite`),
 * so an approved item is indistinguishable from one typed by hand — same
 * validation, same org stamping, same audit trail.
 */
const IntakeContext = createContext(null);

const COLLECTION = 'intakeItems';
const MAX_ITEMS = 500;

export function IntakeProvider({ children }) {
  const { items, loading, error } = useOrgCollection(COLLECTION, { limit: MAX_ITEMS });
  const { addCost } = useCosts();

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

  const patchItem = useCallback(async (docId, patch) => {
    await orgUpdate(COLLECTION, docId, {
      ...patch,
      updatedAt: new Date().toISOString(),
    }, { rethrow: true, errorMessage: 'Failed to update the intake item' });
  }, []);

  /**
   * Approve one item: write the real record, then mark the item approved.
   * Order matters — if the cost write fails, the item stays pending so the
   * owner can retry instead of silently losing the expense.
   */
  const approve = useCallback(async (item, overrides = {}) => {
    if (!item?._docId) throw new Error('approve: item has no document id');
    const payload = { ...item.payload, ...overrides };

    let committedRef = item.committedRef || null;
    if (item.kind === 'cost') {
      const created = await addCost({
        name: payload.name,
        amount: Number(payload.amount) || 0,
        category: payload.category || 'Unknown',
        frequency: 'one-time',
        startDate: payload.date,
        notes: payload.notes || null,
        vatIncluded: payload.vatAmount != null ? true : undefined,
        vatAmount: payload.vatAmount != null ? Number(payload.vatAmount) : undefined,
        source: `autopilot-${item.source}`,
        _intakeRef: `${item.source}:${item.sourceRef}`,
      });
      committedRef = created?.id || null;
    }

    await patchItem(item._docId, {
      status: 'approved',
      payload,
      committedRef,
      decidedAt: new Date().toISOString(),
    });
    return committedRef;
  }, [addCost, patchItem]);

  const reject = useCallback(async (item, reason = null) => {
    if (!item?._docId) throw new Error('reject: item has no document id');
    await patchItem(item._docId, {
      status: 'rejected',
      rejectionReason: reason,
      decidedAt: new Date().toISOString(),
    });
  }, [patchItem]);

  /** Approve several at once — the "✅ all" path, sequential so one failure stops the rest. */
  const approveMany = useCallback(async (list) => {
    const results = { approved: 0, failed: [] };
    for (const item of list) {
      try {
        await approve(item);
        results.approved += 1;
      } catch (err) {
        results.failed.push({ id: item._docId, error: err?.message || String(err) });
      }
    }
    return results;
  }, [approve]);

  const value = useMemo(() => ({
    all, pending, recentlyHandled, bySource,
    loading,
    // A missing table (migration not applied yet) must not break the app: the
    // queue simply reads empty and the page explains why.
    error: error ? error.message : null,
    approve, approveMany, reject,
    STATUSES: INTAKE_STATUSES,
  }), [all, pending, recentlyHandled, bySource, loading, error, approve, approveMany, reject]);

  return <IntakeContext.Provider value={value}>{children}</IntakeContext.Provider>;
}

export const useIntake = () => {
  const ctx = useContext(IntakeContext);
  if (!ctx) throw new Error('useIntake must be used inside IntakeProvider');
  return ctx;
};
