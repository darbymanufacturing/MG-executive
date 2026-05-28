import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  collection, doc, onSnapshot, setDoc, deleteDoc,
  updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';

const PowContext = createContext(null);

const DEFAULT_CATEGORIES = [
  { id: 'cat-tech',   name: 'Tech / Dev',   order: 0 },
  { id: 'cat-ops',    name: 'Operations',   order: 1 },
  { id: 'cat-biz',    name: 'Business',     order: 2 },
];

const CONFIG_DOC = 'pow/config';
const TASKS_COL  = 'pow_tasks';

// statuses: 'backlog' | 'pow' | 'done'
// assignees: string[]  (e.g. ['Panos', 'Kostas'])
// checkedSteps: number[]  (indices of checked steps in summary)

export function PowProvider({ children }) {
  const [categories, setCategories]        = useState(DEFAULT_CATEGORIES);
  const [tasks, setTasks]                  = useState([]);
  const [currentWeek, setCurrentWeekState] = useState(25);
  const [showDone, setShowDone]            = useState(false);
  const [loading, setLoading]              = useState(true);

  // ── Subscribe to config ──────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(doc(db, CONFIG_DOC), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.categories?.length) setCategories(data.categories);
        if (data.currentWeek)        setCurrentWeekState(data.currentWeek);
      }
    });
    return unsub;
  }, []);

  // ── Subscribe to tasks ───────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(collection(db, TASKS_COL), (snap) => {
      const list = snap.docs.map(d => {
        const data = d.data();
        // Normalize assignees: old tasks may have assignee (string) or none
        const assignees = data.assignees
          ?? (data.assignee ? [data.assignee] : []);
        // Normalize status: old tasks used 'todo', new system uses 'backlog'/'pow'
        let status = data.status;
        if (status === 'todo') {
          status = assignees.length > 0 ? 'pow' : 'backlog';
        }
        // Normalize steps: old tasks have summary (string), new have steps (array)
        let steps = data.steps;
        if (!steps) {
          // parse old summary string into array
          steps = (data.summary ?? '')
            .split('\n')
            .map(l => l.replace(/^(\d+[\.\)]|[-•])\s+/, '').trim())
            .filter(Boolean);
        }
        return {
          id: d.id,
          ...data,
          assignees,
          steps,
          checkedSteps: data.checkedSteps ?? [],
          powSteps: data.powSteps ?? {},    // { Panos: [0,1], Kostas: [2] }
          powWeeks: data.powWeeks ?? {},   // { Panos: 25, Kostas: 26 }
          status,
        };
      });
      list.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
      setTasks(list);
      setLoading(false);
    });
    return unsub;
  }, []);

  // ── Config ───────────────────────────────────────────────────────────────
  const saveConfig = useCallback(async (patch) => {
    await safeWrite(
      () => setDoc(doc(db, CONFIG_DOC), patch, { merge: true }),
      { rethrow: true, errorMessage: 'Failed to save POW config' },
    );
  }, []);

  const setCurrentWeek = useCallback((week) => {
    saveConfig({ currentWeek: week });
  }, [saveConfig]);

  // ── Categories ───────────────────────────────────────────────────────────
  const addCategory = useCallback((name) => {
    const newCat = { id: `cat-${Date.now()}`, name, order: categories.length };
    saveConfig({ categories: [...categories, newCat] });
  }, [categories, saveConfig]);

  const removeCategory = useCallback((catId) => {
    const updated = categories.filter(c => c.id !== catId).map((c, i) => ({ ...c, order: i }));
    saveConfig({ categories: updated });
  }, [categories, saveConfig]);

  const renameCategory = useCallback((catId, name) => {
    saveConfig({ categories: categories.map(c => c.id === catId ? { ...c, name } : c) });
  }, [categories, saveConfig]);

  // ── Tasks ─────────────────────────────────────────────────────────────────

  const addTask = useCallback(async ({ title, description, steps, categoryId }) => {
    const id = `task-${Date.now()}`;
    await safeWrite(
      () => setDoc(doc(db, TASKS_COL, id), {
        title, description, steps, categoryId,
        assignees: [],
        checkedSteps: [],
        powSteps: {},
        status: 'backlog',
        createdWeek: currentWeek,
        doneWeek: null,
        createdAt: serverTimestamp(),
      }),
      { rethrow: true, errorMessage: 'Failed to create POW task' },
    );
  }, [currentWeek]);

  const updateTask = useCallback(async (id, patch) => {
    await safeWrite(
      () => updateDoc(doc(db, TASKS_COL, id), patch),
      { rethrow: true, errorMessage: 'Failed to update POW task' },
    );
  }, []);

  /** Assign a person with specific step indices for POW. Pass stepIndices=null to remove. */
  const toggleAssignee = useCallback(async (id, person, stepIndices = null) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const current    = task.assignees ?? [];
    const isRemoving = current.includes(person) && stepIndices === null;

    let assignees = current;
    let powSteps  = { ...(task.powSteps ?? {}) };
    let powWeeks  = { ...(task.powWeeks ?? {}) };  // { Panos: 25, Kostas: 26 }

    if (isRemoving) {
      assignees = current.filter(a => a !== person);
      delete powSteps[person];
      delete powWeeks[person];
    } else {
      // Add or update
      if (!current.includes(person)) assignees = [...current, person];
      powSteps[person] = stepIndices ?? [];
      powWeeks[person] = currentWeek;
    }

    await safeWrite(
      () => updateDoc(doc(db, TASKS_COL, id), {
        assignees,
        powSteps,
        powWeeks,
        status: assignees.length > 0 ? 'pow' : 'backlog',
      }),
      { rethrow: true, errorMessage: 'Failed to update POW assignees' },
    );
  }, [tasks, currentWeek]);

  /** Toggle a step checkbox by its index */
  const toggleStep = useCallback(async (id, stepIndex) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const checked = task.checkedSteps ?? [];
    const checkedSteps = checked.includes(stepIndex)
      ? checked.filter(i => i !== stepIndex)
      : [...checked, stepIndex];
    await safeWrite(
      () => updateDoc(doc(db, TASKS_COL, id), { checkedSteps }),
      { rethrow: true, errorMessage: 'Failed to update POW step' },
    );
  }, [tasks]);

  const markDone = useCallback(async (id) => {
    await safeWrite(
      () => updateDoc(doc(db, TASKS_COL, id), {
        status: 'done',
        doneWeek: currentWeek,
      }),
      { rethrow: true, errorMessage: 'Failed to mark POW task done' },
    );
  }, [currentWeek]);

  const markBacklog = useCallback(async (id) => {
    await safeWrite(
      () => updateDoc(doc(db, TASKS_COL, id), {
        status: 'backlog',
        assignees: [],
        doneWeek: null,
      }),
      { rethrow: true, errorMessage: 'Failed to move POW task back to backlog' },
    );
  }, []);

  const deleteTask = useCallback(async (id) => {
    await safeWrite(
      () => deleteDoc(doc(db, TASKS_COL, id)),
      { rethrow: true, errorMessage: 'Failed to delete POW task' },
    );
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────
  const backlogTasks = tasks.filter(t => t.status === 'backlog');
  const powTasks     = tasks.filter(t => t.status === 'pow');
  const doneTasks    = tasks.filter(t => t.status === 'done' && t.doneWeek === currentWeek);
  const allTodoTasks = [
    ...tasks.filter(t => t.status !== 'done'),
    ...(showDone ? doneTasks : []),
  ];

  return (
    <PowContext.Provider value={{
      categories, currentWeek, showDone, loading,
      tasks, backlogTasks, powTasks, doneTasks, allTodoTasks,
      setCurrentWeek, setShowDone,
      addCategory, removeCategory, renameCategory,
      addTask, updateTask,
      toggleAssignee, toggleStep,
      markDone, markBacklog, deleteTask,
    }}>
      {children}
    </PowContext.Provider>
  );
}

export const usePow = () => useContext(PowContext);
