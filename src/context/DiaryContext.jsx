import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, orderBy, query, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';

// --- peer contexts (DiaryProvider must be mounted inside these providers in App.jsx)
import { useCosts } from './CostContext.jsx';
import { useRevenue } from './RevenueContext.jsx';
import { useMaintenance } from './MaintenanceContext.jsx';
import { useProjects } from './ProjectContext.jsx';

const DiaryContext = createContext(null);

export function DiaryProvider({ children }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  // Peer context functions
  const { addCost } = useCosts();
  const { importRevenueDays } = useRevenue();
  const { addTicket, addPart, addScooter } = useMaintenance();
  const { addProject, addMilestone, addBlocker, addUpdate, addGate, activeProjects } = useProjects();

  /* ── Real-time listener ── */
  useEffect(() => {
    const q = query(collection(db, 'diary'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setEntries(snap.docs.map((d) => ({ ...d.data(), _docId: d.id })));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, []);

  /* ── Save raw entry (before applying) ── */
  const saveDraftEntry = useCallback(async ({ rawText, summary, actions, unresolved }) => {
    const result = await safeWrite(
      () => addDoc(collection(db, 'diary'), {
        rawText,
        summary,
        actions: actions.map((a) => ({ ...a, executed: false, docId: null })),
        unresolved: unresolved || [],
        status: 'pending',
        history: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
      { rethrow: true, errorMessage: 'Failed to save diary draft' },
    );
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
            const proj = activeProjects.find(
              (p) => p.name?.toLowerCase() === action.data.projectName?.toLowerCase()
            );
            if (proj) await addMilestone(proj._docId, { title: action.data.title, dueDate: action.data.dueDate || null });
            break;
          }
          case 'blocker': {
            const proj = activeProjects.find(
              (p) => p.name?.toLowerCase() === action.data.projectName?.toLowerCase()
            );
            if (proj) await addBlocker(proj._docId, action.data.text);
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
            await addGate(action.data);
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
    await safeWrite(
      () => updateDoc(doc(db, 'diary', docId), {
        actions: updatedActions,
        status,
        updatedAt: serverTimestamp(),
      }),
      { rethrow: true, errorMessage: 'Failed to save diary apply result' },
    );
  }, [entries, addCost, importRevenueDays, addTicket, addPart, addScooter,
      addProject, addMilestone, addBlocker, addUpdate, addGate, activeProjects]);

  /* ── Reject / discard entry ── */
  const rejectEntry = useCallback(async (docId) => {
    await safeWrite(
      () => updateDoc(doc(db, 'diary', docId), {
        status: 'rejected',
        updatedAt: serverTimestamp(),
      }),
      { rethrow: true, errorMessage: 'Failed to reject diary entry' },
    );
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
    await safeWrite(
      () => updateDoc(doc(db, 'diary', docId), {
        rawText,
        summary,
        actions: actions.map((a) => ({ ...a, executed: false, docId: null })),
        unresolved: unresolved || [],
        status: 'pending',
        history: [...(entry.history || []), histEntry],
        updatedAt: serverTimestamp(),
      }),
      { rethrow: true, errorMessage: 'Failed to update diary entry' },
    );
  }, [entries]);

  /* ── Delete ── */
  const deleteEntry = useCallback(async (docId) => {
    await safeWrite(
      () => deleteDoc(doc(db, 'diary', docId)),
      { rethrow: true, errorMessage: 'Failed to delete diary entry' },
    );
  }, []);

  return (
    <DiaryContext.Provider value={{
      entries, loading,
      saveDraftEntry, applyEntry, rejectEntry, editEntry, deleteEntry,
    }}>
      {children}
    </DiaryContext.Provider>
  );
}

export function useDiary() {
  const ctx = useContext(DiaryContext);
  if (!ctx) throw new Error('useDiary must be used inside DiaryProvider');
  return ctx;
}
