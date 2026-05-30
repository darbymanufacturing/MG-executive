import { createContext, useContext, useState, useMemo, useCallback } from 'react';
import { useOrg } from './OrgContext.jsx';
import { useOrgCollection } from '../hooks/useOrgCollection.js';
import { useOrgDoc } from '../hooks/useOrgDoc.js';
import { orgWrite, orgUpdate, orgDelete } from '../hooks/orgWrite.js';

const PowContext = createContext(null);

const TASKS_COL  = 'pow_tasks';
const CONFIG_COL = 'pow';            // org-scoped singleton: pow/${orgId}_config (was pow/config)
const MAX_POW_TASKS = 1000;          // Phase 2: bound the previously-unbounded listener (#365 family)

const DEFAULT_CATEGORIES = [
  { id: 'cat-tech',   name: 'Tech / Dev',   order: 0 },
  { id: 'cat-ops',    name: 'Operations',   order: 1 },
  { id: 'cat-biz',    name: 'Business',     order: 2 },
];

// Week 1 = Nov 3, 2025 (Monday) — must match Pow.jsx
const WEEK1_START_MS = new Date('2025-11-03T00:00:00').getTime();
function computeCurrentWeek() {
  return Math.max(1, Math.ceil((Date.now() - WEEK1_START_MS) / (7 * 24 * 60 * 60 * 1000)));
}

export function PowProvider({ children }) {
  const { orgId } = useOrg();
  const configDocId = orgId ? `${orgId}_config` : null;
  const [showDone, setShowDone] = useState(false);

  // ── Reads (ADR-0003 org-scoped) ──────────────────────────────────────────
  const { items, loading, error } = useOrgCollection(TASKS_COL, { limit: MAX_POW_TASKS });
  const { item: configItem } = useOrgDoc(CONFIG_COL, configDocId);

  const categories = useMemo(
    () => (configItem?.categories?.length ? configItem.categories : DEFAULT_CATEGORIES),
    [configItem],
  );
  const currentWeek = configItem?.currentWeek || computeCurrentWeek();

  // Normalize each task (back-compat for old assignee/summary/todo-status docs).
  const tasks = useMemo(() => {
    const list = items.map((data) => {
      const assignees = data.assignees ?? (data.assignee ? [data.assignee] : []);
      let status = data.status;
      if (status === 'todo') status = assignees.length > 0 ? 'pow' : 'backlog';
      let steps = data.steps;
      if (!steps) {
        steps = (data.summary ?? '')
          .split('\n')
          .map((l) => l.replace(/^(\d+[.)]|[-•])\s+/, '').trim())
          .filter(Boolean);
      }
      return {
        id: data._docId,
        ...data,
        assignees,
        steps,
        checkedSteps: data.checkedSteps ?? [],
        powSteps: data.powSteps ?? {},
        powWeeks: data.powWeeks ?? {},
        status,
      };
    });
    list.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
    return list;
  }, [items]);

  // ── Config ───────────────────────────────────────────────────────────────
  const saveConfig = useCallback(async (patch) => {
    await orgWrite(CONFIG_COL, patch, {
      id: configDocId, merge: true, rethrow: true, errorMessage: 'Failed to save POW config',
    });
  }, [configDocId]);

  const setCurrentWeek = useCallback((week) => { saveConfig({ currentWeek: week }); }, [saveConfig]);

  const addCategory = useCallback((name) => {
    const newCat = { id: `cat-${crypto.randomUUID()}`, name, order: categories.length };
    saveConfig({ categories: [...categories, newCat] });
  }, [categories, saveConfig]);

  const removeCategory = useCallback((catId) => {
    const updated = categories.filter((c) => c.id !== catId).map((c, i) => ({ ...c, order: i }));
    saveConfig({ categories: updated });
  }, [categories, saveConfig]);

  const renameCategory = useCallback((catId, name) => {
    saveConfig({ categories: categories.map((c) => (c.id === catId ? { ...c, name } : c)) });
  }, [categories, saveConfig]);

  // ── Tasks ─────────────────────────────────────────────────────────────────
  const addTask = useCallback(async ({ title, description, steps, categoryId }) => {
    const id = `task-${crypto.randomUUID()}`;
    await orgWrite(TASKS_COL, {
      title, description, steps, categoryId,
      assignees: [], checkedSteps: [], powSteps: {},
      status: 'backlog', createdWeek: currentWeek, doneWeek: null,
    }, { id, rethrow: true, errorMessage: 'Failed to create POW task' });
  }, [currentWeek]);

  const updateTask = useCallback(async (id, patch) => {
    await orgUpdate(TASKS_COL, id, patch, { rethrow: true, errorMessage: 'Failed to update POW task' });
  }, []);

  /** Assign a person with specific step indices for POW. Pass stepIndices=null to remove. */
  const toggleAssignee = useCallback(async (id, person, stepIndices = null) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const current = task.assignees ?? [];
    const isRemoving = current.includes(person) && stepIndices === null;

    let assignees = current;
    const powSteps = { ...(task.powSteps ?? {}) };
    const powWeeks = { ...(task.powWeeks ?? {}) };

    if (isRemoving) {
      assignees = current.filter((a) => a !== person);
      delete powSteps[person];
      delete powWeeks[person];
    } else {
      if (!current.includes(person)) assignees = [...current, person];
      powSteps[person] = stepIndices ?? [];
      powWeeks[person] = currentWeek;
    }

    await orgUpdate(TASKS_COL, id, {
      assignees, powSteps, powWeeks,
      status: assignees.length > 0 ? 'pow' : 'backlog',
    }, { rethrow: true, errorMessage: 'Failed to update POW assignees' });
  }, [tasks, currentWeek]);

  /** Toggle a step checkbox by its index */
  const toggleStep = useCallback(async (id, stepIndex) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const checked = task.checkedSteps ?? [];
    const checkedSteps = checked.includes(stepIndex)
      ? checked.filter((i) => i !== stepIndex)
      : [...checked, stepIndex];
    await orgUpdate(TASKS_COL, id, { checkedSteps }, { rethrow: true, errorMessage: 'Failed to update POW step' });
  }, [tasks]);

  const markDone = useCallback(async (id) => {
    await orgUpdate(TASKS_COL, id, { status: 'done', doneWeek: currentWeek }, {
      rethrow: true, errorMessage: 'Failed to mark POW task done',
    });
  }, [currentWeek]);

  const markBacklog = useCallback(async (id) => {
    await orgUpdate(TASKS_COL, id, { status: 'backlog', assignees: [], doneWeek: null }, {
      rethrow: true, errorMessage: 'Failed to move POW task back to backlog',
    });
  }, []);

  const deleteTask = useCallback(async (id) => {
    await orgDelete(TASKS_COL, id, { rethrow: true, errorMessage: 'Failed to delete POW task' });
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────
  const backlogTasks = useMemo(() => tasks.filter((t) => t.status === 'backlog'), [tasks]);
  const powTasks     = useMemo(() => tasks.filter((t) => t.status === 'pow'), [tasks]);
  const doneTasks    = useMemo(
    () => tasks.filter((t) => t.status === 'done' && t.doneWeek === currentWeek),
    [tasks, currentWeek],
  );
  const allTodoTasks = useMemo(
    () => [...tasks.filter((t) => t.status !== 'done'), ...(showDone ? doneTasks : [])],
    [tasks, showDone, doneTasks],
  );

  const value = useMemo(() => ({
    categories, currentWeek, showDone, loading, snapshotError: error ? error.message : null,
    tasks, backlogTasks, powTasks, doneTasks, allTodoTasks,
    setCurrentWeek, setShowDone,
    addCategory, removeCategory, renameCategory,
    addTask, updateTask, toggleAssignee, toggleStep, markDone, markBacklog, deleteTask,
  }), [
    categories, currentWeek, showDone, loading, error,
    tasks, backlogTasks, powTasks, doneTasks, allTodoTasks,
    setCurrentWeek, addCategory, removeCategory, renameCategory,
    addTask, updateTask, toggleAssignee, toggleStep, markDone, markBacklog, deleteTask,
  ]);

  return <PowContext.Provider value={value}>{children}</PowContext.Provider>;
}

export const usePow = () => {
  const ctx = useContext(PowContext);
  if (!ctx) throw new Error('usePow must be used inside PowProvider');
  return ctx;
};
