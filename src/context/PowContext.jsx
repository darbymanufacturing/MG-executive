import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  collection, doc, onSnapshot, setDoc, deleteDoc,
  updateDoc, serverTimestamp, writeBatch
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

export function PowProvider({ children }) {
  const [categories, setCategories]   = useState(DEFAULT_CATEGORIES);
  const [tasks, setTasks]             = useState([]);
  const [currentWeek, setCurrentWeekState] = useState(25);
  const [showDone, setShowDone]       = useState(false);
  const [loading, setLoading]         = useState(true);

  // ── Subscribe to config doc ──────────────────────────────────────────────
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

  // ── Week ─────────────────────────────────────────────────────────────────
  const setCurrentWeek = useCallback((week) => {
    saveConfig({ currentWeek: week });
  }, [saveConfig]);

  // ── Categories ───────────────────────────────────────────────────────────
  const addCategory = useCallback((name) => {
    const newCat = { id: `cat-${Date.now()}`, name, order: categories.length };
    const updated = [...categories, newCat];
    saveConfig({ categories: updated });
  }, [categories, saveConfig]);

  const removeCategory = useCallback((catId) => {
    const updated = categories.filter(c => c.id !== catId).map((c, i) => ({ ...c, order: i }));
    saveConfig({ categories: updated });
  }, [categories, saveConfig]);

  const renameCategory = useCallback((catId, name) => {
    const updated = categories.map(c => c.id === catId ? { ...c, name } : c);
    saveConfig({ categories: updated });
  }, [categories, saveConfig]);

  // ── Tasks ─────────────────────────────────────────────────────────────────
  const addTask = useCallback(async ({ title, assignee, description, summary, categoryId }) => {
    const id  = `task-${Date.now()}`;
    await setDoc(doc(db, TASKS_COL, id), {
      title,
      assignee,
      description,
      summary,
      categoryId,
      status: 'todo',
      createdWeek: currentWeek,
      doneWeek: null,
      createdAt: serverTimestamp(),
    });
  }, [currentWeek]);

  const updateTask = useCallback(async (id, patch) => {
    await updateDoc(doc(db, TASKS_COL, id), patch);
  }, []);

  const markDone = useCallback(async (id) => {
    await updateDoc(doc(db, TASKS_COL, id), {
      status: 'done',
      doneWeek: currentWeek,
    });
  }, [currentWeek]);

  const markTodo = useCallback(async (id) => {
    await updateDoc(doc(db, TASKS_COL, id), {
      status: 'todo',
      doneWeek: null,
    });
  }, []);

  const deleteTask = useCallback(async (id) => {
    await deleteDoc(doc(db, TASKS_COL, id));
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────
  const activeTasks = tasks.filter(t => t.status !== 'done');
  const doneTasks   = tasks.filter(t => t.status === 'done' && t.doneWeek === currentWeek);

  return (
    <PowContext.Provider value={{
      categories, currentWeek, showDone, loading,
      tasks, activeTasks, doneTasks,
      setCurrentWeek, setShowDone,
      addCategory, removeCategory, renameCategory,
      addTask, updateTask, markDone, markTodo, deleteTask,
    }}>
      {children}
    </PowContext.Provider>
  );
}

export const usePow = () => useContext(PowContext);
