import { createContext, useContext, useMemo, useCallback } from 'react';
import { useOrgCollection } from '../hooks/useOrgCollection.js';
import { orgWrite, orgUpdate, orgDelete } from '../hooks/orgWrite.js';

// --- peer contexts (DiaryProvider must be mounted inside these providers in App.jsx).
// These are now org-aware (Phase 2 / ADR-0003), so applyEntry's writes are automatically
// scoped to the active org — no extra work needed here beyond converting diary's own reads/writes.
import { useCosts } from './CostContext.jsx';
import { useRevenue } from './RevenueContext.jsx';
import { useMaintenance } from './MaintenanceContext.jsx';
import { useProjects } from './ProjectContext.jsx';

const DIARY_COL = 'diary';
const MAX_DIARY = 1000;

const DiaryContext = createContext(null);

export function DiaryProvider({ children }) {
  // Phase 2 (ADR-0003): org-scoped read of the diary collection (auto-id docs → collision-safe).
  const { items, loading } = useOrgCollection(DIARY_COL, {
    orderBy: ['createdAt', 'desc'],
    limit: MAX_DIARY,
  });
  // Preserve the public shape: consumers read `_docId`.
  const entries = items;

  // Peer context functions (already org-aware after B3).
  const { addCost } = useCosts();
  const { importRevenueDays } = useRevenue();
  const { addTicket, addPart, addScooter } = useMaintenance();
  // BUG #20 — addMilestone and addGate don't exist on ProjectContext; removed from destructure
  const { addProject, addBlocker, addUpdate, activeProjects } = useProjects();

  /* ── Save raw entry (before applying) ── */
  const saveDraftEntry = useCallback(async ({ rawText, summary, actions, unresolved }) => {
    const result = await orgWrite(DIARY_COL, {
      rawText,
      summary,
      actions: actions.map((a) => ({ ...a, executed: false, docId: null })),
      unresolved: unresolved || [],
      status: 'pending',
      history: [],
    }, { rethrow: true, errorMessage: 'Failed to save diary draft' });
    return result.data.id;
  }, []);

  /* ── Apply actions for a saved entry ── */
  const applyEntry = useCallback(async (docId) => {
    const entry = entries.find((e) => e._docId === docId);
    if (!entry) return;

    const updatedActions = [...entry.actions];
    let anyFailed = false;

    for (let i = 0; i < updatedActions.length; i++) {
      const action = updatedActions[i];
      if (action.executed) continue;
      try {
        let resultDocId = null;

        switch (action.module) {
          case 'cost':
            await addCost({ ...action.data, id: crypto.randomUUID() });
            break;
          case 'revenue':
            await importRevenueDays([action.data]);
            break;
          case 'ticket':
            resultDocId = await addTicket(action.data);
            break;
          case 'part':
            await addPart(action.data);
            break;
          case 'scooter':
            await addScooter(action.data);
            break;
          case 'project':
            await addProject(action.data);
            break;
          case 'milestone': {
            // BUG #20 — addMilestone not yet implemented on ProjectContext
            console.warn('milestone diary actions not yet implemented');
            break;
          }
          case 'blocker': {
            const proj = activeProjects.find(
              (p) => p.name?.toLowerCase() === action.data.projectName?.toLowerCase()
            );
            // BUG #20 — fix addBlocker signature: pass full blocker object, not bare text
            if (proj) await addBlocker(proj._docId, { text: action.data.text, type: 'general', escalation: 'none' });
            break;
          }
          case 'update': {
            const proj = activeProjects.find(
              (p) => p.name?.toLowerCase() === action.data.projectName?.toLowerCase()
            );
            if (proj) await addUpdate(proj._docId, action.data.text);
            break;
          }
          case 'gate':
            // BUG #20 — addGate not yet implemented on ProjectContext
            console.warn('gate diary actions not yet implemented');
            break;
          default:
            break;
        }

        updatedActions[i] = { ...action, executed: true, docId: resultDocId };
      } catch (err) {
        console.error('Diary action failed:', action, err);
        updatedActions[i] = { ...action, executed: false, error: err.message };
        anyFailed = true;
      }
    }

    const status = anyFailed ? 'partial' : 'applied';
    await orgUpdate(DIARY_COL, docId, { actions: updatedActions, status }, {
      rethrow: true, errorMessage: 'Failed to save diary apply result',
    });
  }, [entries, addCost, importRevenueDays, addTicket, addPart, addScooter,
      addProject, addBlocker, addUpdate, activeProjects]);

  /* ── Reject / discard entry ── */
  const rejectEntry = useCallback(async (docId) => {
    await orgUpdate(DIARY_COL, docId, { status: 'rejected' }, {
      rethrow: true, errorMessage: 'Failed to reject diary entry',
    });
  }, []);

  /* ── Edit raw text (re-parse done in DiaryBubble, then call this) ── */
  const editEntry = useCallback(async (docId, { rawText, summary, actions, unresolved }) => {
    const entry = entries.find((e) => e._docId === docId);
    if (!entry) return;
    const histEntry = {
      editedAt: new Date().toISOString(),
      previousRaw: entry.rawText,
      previousSummary: entry.summary,
    };
    await orgUpdate(DIARY_COL, docId, {
      rawText,
      summary,
      actions: actions.map((a) => ({ ...a, executed: false, docId: null })),
      unresolved: unresolved || [],
      status: 'pending',
      history: [...(entry.history || []), histEntry],
    }, { rethrow: true, errorMessage: 'Failed to update diary entry' });
  }, [entries]);

  /* ── Delete ── */
  const deleteEntry = useCallback(async (docId) => {
    await orgDelete(DIARY_COL, docId, { rethrow: true, errorMessage: 'Failed to delete diary entry' });
  }, []);

  const value = useMemo(() => ({
    entries, loading,
    saveDraftEntry, applyEntry, rejectEntry, editEntry, deleteEntry,
  }), [entries, loading, saveDraftEntry, applyEntry, rejectEntry, editEntry, deleteEntry]);

  return (
    <DiaryContext.Provider value={value}>
      {children}
    </DiaryContext.Provider>
  );
}

export function useDiary() {
  const ctx = useContext(DiaryContext);
  if (!ctx) throw new Error('useDiary must be used inside DiaryProvider');
  return ctx;
}
