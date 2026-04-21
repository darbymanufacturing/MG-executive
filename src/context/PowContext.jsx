import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  collection, doc, onSnapshot, setDoc, deleteDoc,
  updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';

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
        // Normalize: old tasks may have assignee (string) instead of assignees (array)
        const assignees = data.assignees
          ?? (data.assignee ? [data.assignee] : []);
        return {
          id: d.id,
          ...data,
          assignees,
          checkedSteps: data.checkedSteps ?? [],
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
    await setDoc(doc(db, CONFIG_DOC), patch, { merge: true });
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

  const addTask = useCallback(async ({ title, description, summary, categoryId }) => {
    const id = `task-${Date.now()}`;
    await setDoc(doc(db, TASKS_COL, id), {
      title, description, summary, categoryId,
      assignees: [],
      checkedSteps: [],
      status: 'backlog',
      createdWeek: currentWeek,
      doneWeek: null,
      createdAt: serverTimestamp(),
    });
  }, [currentWeek]);

  const updateTask = useCallback(async (id, patch) => {
    await updateDoc(doc(db, TASKS_COL, id), patch);
  }, []);

  /** Toggle a person in/out of assignees. Sets status to 'pow' if any assigned, else 'backlog'. */
  const toggleAssignee = useCallback(async (id, person) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const current = task.assignees ?? [];
    const assignees = current.includes(person)
      ? current.filter(a => a !== person)
      : [...current, person];
    await updateDoc(doc(db, TASKS_COL, id), {
      assignees,
      status: assignees.length > 0 ? 'pow' : 'backlog',
    });
  }, [tasks]);

  /** Toggle a step checkbox by its index */
  const toggleStep = useCallback(async (id, stepIndex) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const checked = task.checkedSteps ?? [];
    const checkedSteps = checked.includes(stepIndex)
      ? checked.filter(i => i !== stepIndex)
      : [...checked, stepIndex];
    await updateDoc(doc(db, TASKS_COL, id), { checkedSteps });
  }, [tasks]);

  const markDone = useCallback(async (id) => {
    await updateDoc(doc(db, TASKS_COL, id), {
      status: 'done',
      doneWeek: currentWeek,
    });
  }, [currentWeek]);

  const markBacklog = useCallback(async (id) => {
    await updateDoc(doc(db, TASKS_COL, id), {
      status: 'backlog',
      assignees: [],
      doneWeek: null,
    });
  }, []);

  const deleteTask = useCallback(async (id) => {
    await deleteDoc(doc(db, TASKS_COL, id));
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
