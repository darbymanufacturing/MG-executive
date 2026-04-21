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

export function PowProvider({ children }) {
  const [categories, setCategories]     = useState(DEFAULT_CATEGORIES);
  const [tasks, setTasks]               = useState([]);
  const [currentWeek, setCurrentWeekState] = useState(25);
  const [showDone, setShowDone]         = useState(false);
  const [loading, setLoading]           = useState(true);

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
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
      setTasks(list);
      setLoading(false);
    });
    return unsub;
  }, []);

  // ── Persist config ───────────────────────────────────────────────────────
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

  /** Add a new task to the backlog (To Do List). No assignee required. */
  const addTask = useCallback(async ({ title, description, summary, categoryId }) => {
    const id = `task-${Date.now()}`;
    await setDoc(doc(db, TASKS_COL, id), {
      title,
      description,
      summary,
      categoryId,
      assignee: null,
      status: 'backlog',
      createdWeek: currentWeek,
      doneWeek: null,
      createdAt: serverTimestamp(),
    });
  }, [currentWeek]);

  const updateTask = useCallback(async (id, patch) => {
    await updateDoc(doc(db, TASKS_COL, id), patch);
  }, []);

  /** Move a task from backlog → POW board with an assignee */
  const assignToPow = useCallback(async (id, assignee) => {
    await updateDoc(doc(db, TASKS_COL, id), {
      assignee,
      status: 'pow',
    });
  }, []);

  /** Remove task from POW board → back to backlog */
  const removeFromPow = useCallback(async (id) => {
    await updateDoc(doc(db, TASKS_COL, id), {
      assignee: null,
      status: 'backlog',
    });
  }, []);

  const markDone = useCallback(async (id) => {
    await updateDoc(doc(db, TASKS_COL, id), {
      status: 'done',
      doneWeek: currentWeek,
    });
  }, [currentWeek]);

  const markBacklog = useCallback(async (id) => {
    await updateDoc(doc(db, TASKS_COL, id), {
      status: 'backlog',
      assignee: null,
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
  const allTodoTasks = [...tasks.filter(t => t.status !== 'done'), ...(showDone ? doneTasks : [])];

  return (
    <PowContext.Provider value={{
      categories, currentWeek, showDone, loading,
      tasks, backlogTasks, powTasks, doneTasks, allTodoTasks,
      setCurrentWeek, setShowDone,
      addCategory, removeCategory, renameCategory,
      addTask, updateTask,
      assignToPow, removeFromPow,
      markDone, markBacklog, deleteTask,
    }}>
      {children}
    </PowContext.Provider>
  );
}

export const usePow = () => useContext(PowContext);
