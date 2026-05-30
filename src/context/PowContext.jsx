import { createContext, useContext, useState, useMemo, useCallback } from 'react';
import { useOrg } from './OrgContext.jsx';
import { useOrgCollection } from '../hooks/useOrgCollection.js';
import { useOrgDoc } from '../hooks/useOrgDoc.js';
import { orgWrite, orgUpdate, orgDelete } from '../hooks/orgWrite.js';
import { POW_CATEGORIES, CURRENT_WEEK } from '../utils/powConstants.js';

const PowContext = createContext(null);

const TASKS_COL = 'pow_tasks';
const CONFIG_COL = 'pow';        // org-scoped singleton: pow/${orgId}_config (was pow/config)
const MAX_POW_TASKS = 1000;      // Phase 2: bound the previously-unbounded listener (#365 family)

export function PowProvider({ children }) {
  const { orgId } = useOrg();
  const configDocId = orgId ? `${orgId}_config` : null;
  const [showDone, setShowDone] = useState(false);

  // ── Reads (ADR-0003 org-scoped) ──────────────────────────────────────────
  const { items, loading, error } = useOrgCollection(TASKS_COL, {
    orderBy: ['createdAt', 'desc'],
    limit: MAX_POW_TASKS,
  });
  const { item: configItem } = useOrgDoc(CONFIG_COL, configDocId);

  // Optimistic local state is dropped — onSnapshot latency-compensation makes local
  // writes appear instantly, and categories/currentWeek fall back to defaults when the
  // org has no config doc yet.
  const tasks = useMemo(
    () => items.map(({ _docId, ...rest }) => ({ id: _docId, ...rest })),
    [items],
  );
  const categories = useMemo(
    () => (configItem && Array.isArray(configItem.categories) ? configItem.categories : POW_CATEGORIES),
    [configItem],
  );
  const currentWeek = configItem?.currentWeek || CURRENT_WEEK;

  const persistConfig = useCallback(async (partial) => {
    await orgWrite(CONFIG_COL, partial, {
      id: configDocId, merge: true, rethrow: true, errorMessage: 'Failed to save POW config',
    });
  }, [configDocId]);

  const setCurrentWeekAndPersist = useCallback(async (week) => {
    await persistConfig({ currentWeek: week });
  }, [persistConfig]);

  const addCategory = useCallback(async (cat) => {
    await persistConfig({ categories: [...categories, cat] });
  }, [categories, persistConfig]);

  const removeCategory = useCallback(async (catId) => {
    await persistConfig({ categories: categories.filter((c) => c.id !== catId) });
  }, [categories, persistConfig]);

  const renameCategory = useCallback(async (catId, label) => {
    await persistConfig({ categories: categories.map((c) => (c.id === catId ? { ...c, label } : c)) });
  }, [categories, persistConfig]);

  const addTask = useCallback(async (task) => {
    const id = task.id || crypto.randomUUID();
    const newTask = { ...task, id, createdAt: task.createdAt || new Date().toISOString() };
    await orgWrite(TASKS_COL, newTask, { id, rethrow: true, errorMessage: 'Failed to add task' });
  }, []);

  const updateTask = useCallback(async (id, updates) => {
    await orgUpdate(TASKS_COL, id, updates, { rethrow: true, errorMessage: 'Failed to update task' });
  }, []);

  const toggleAssignee = useCallback(async (taskId, person) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const assignees = task.assignees || [];
    const next = assignees.includes(person)
      ? assignees.filter((p) => p !== person)
      : [...assignees, person];
    await updateTask(taskId, { assignees: next });
  }, [tasks, updateTask]);

  const toggleStep = useCallback(async (taskId, stepIdx) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const steps = [...(task.powSteps || [])];
    steps[stepIdx] = { ...steps[stepIdx], done: !steps[stepIdx]?.done };
    await updateTask(taskId, { powSteps: steps });
  }, [tasks, updateTask]);

  const markDone = useCallback(async (taskId) => {
    await updateTask(taskId, { status: 'done', doneAt: new Date().toISOString() });
  }, [updateTask]);

  const markBacklog = useCallback(async (taskId) => {
    await updateTask(taskId, { status: 'backlog' });
  }, [updateTask]);

  const deleteTask = useCallback(async (taskId) => {
    await orgDelete(TASKS_COL, taskId, { rethrow: true, errorMessage: 'Failed to delete task' });
  }, []);

  const normalizedTasks = useMemo(() => tasks.map((t) => ({
    ...t,
    assignees: t.assignees || (t.assignee ? [t.assignee] : []),
    powSteps: t.powSteps || [],
    powWeeks: t.powWeeks || {},
    status: t.status || 'todo',
  })), [tasks]);

  const backlogTasks = useMemo(
    () => normalizedTasks.filter((t) => t.status === 'backlog'),
    [normalizedTasks],
  );
  const powTasks = useMemo(
    () => normalizedTasks.filter((t) => t.status !== 'backlog' && t.status !== 'done'),
    [normalizedTasks],
  );
  const doneTasks = useMemo(
    () => normalizedTasks.filter((t) => t.status === 'done'),
    [normalizedTasks],
  );
  const allTodoTasks = useMemo(
    () => normalizedTasks.filter((t) => t.status !== 'done'),
    [normalizedTasks],
  );

  const value = useMemo(() => ({
    categories, currentWeek, showDone, loading, snapshotError: error ? error.message : null,
    tasks: powTasks,
    backlogTasks,
    powTasks,
    doneTasks,
    allTodoTasks,
    showDoneToggle: setShowDone,
    setCurrentWeek: setCurrentWeekAndPersist,
    setShowDone,
    addCategory, removeCategory, renameCategory,
    addTask, updateTask, toggleAssignee, toggleStep, markDone, markBacklog, deleteTask,
  }), [categories, currentWeek, showDone, loading, error,
      powTasks, backlogTasks, doneTasks, allTodoTasks,
      setCurrentWeekAndPersist, addCategory, removeCategory, renameCategory,
      addTask, updateTask, toggleAssignee, toggleStep, markDone, markBacklog, deleteTask]);

  return <PowContext.Provider value={value}>{children}</PowContext.Provider>;
}

export function usePow() {
  const ctx = useContext(PowContext);
  if (!ctx) throw new Error('usePow must be used within PowProvider');
  return ctx;
}
