import { useState } from 'react';
import { Plus, Eye, EyeOff, ChevronUp, ChevronDown } from 'lucide-react';
import { PowProvider, usePow } from '../context/PowContext.jsx';
import PowBoard from '../components/Pow/PowBoard.jsx';
import TodoTaskCard from '../components/Pow/TodoTaskCard.jsx';
import TaskCard from '../components/Pow/TaskCard.jsx';
import TaskModal from '../components/Pow/TaskModal.jsx';
import styles from './Pow.module.css';

const ASSIGNEES = ['Panos', 'Kostas'];

function PowInner() {
  const {
    categories, allTodoTasks, powTasks, doneTasks,
    currentWeek, showDone, setShowDone,
    setCurrentWeek, loading,
  } = usePow();

  const [addingTask,      setAddingTask]      = useState(false);
  const [todoCollapsed,   setTodoCollapsed]   = useState(false);
  const [activeCatFilter, setActiveCatFilter] = useState('all');
  const [weekPerson,      setWeekPerson]      = useState(null); // null | 'Panos' | 'Kostas'

  if (loading) {
    return (
      <div className={styles.loadingState}>
        <div className={styles.spinner} />
        <p>Φόρτωση tasks…</p>
      </div>
    );
  }

  const filteredTodoTasks = activeCatFilter === 'all'
    ? allTodoTasks
    : allTodoTasks.filter(t => t.categoryId === activeCatFilter);

  const todoCount = allTodoTasks.filter(t => t.status !== 'done').length;

  // Tasks for the selected person this week (pow + done)
  const weekPersonTasks = weekPerson
    ? [...powTasks, ...(showDone ? doneTasks : [])].filter(t =>
        (t.assignees ?? []).includes(weekPerson)
      )
    : [];

  return (
    <div className={styles.page}>
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div className={styles.titleBlock}>
          <h1 className={styles.pageTitle}>POW <span className={styles.titleAccent}>v3</span></h1>
          <p className={styles.subtitle}>Progress Of Week</p>
        </div>

        <div className={styles.headerControls}>
          <div className={styles.weekControl}>
            <button className={styles.weekBtn} onClick={() => setCurrentWeek(currentWeek - 1)}>
              <ChevronDown size={14}/>
            </button>
            <span className={styles.weekLabel}>Week {currentWeek}</span>
            <button className={styles.weekBtn} onClick={() => setCurrentWeek(currentWeek + 1)}>
              <ChevronUp size={14}/>
            </button>
          </div>

          <button
            className={`${styles.toggleBtn} ${showDone ? styles.active : ''}`}
            onClick={() => setShowDone(v => !v)}
          >
            {showDone ? <Eye size={14}/> : <EyeOff size={14}/>}
            {showDone ? `Done (${doneTasks.length})` : 'Show Done'}
          </button>

          <button className={styles.addBtn} onClick={() => setAddingTask(true)}>
            <Plus size={15}/> New Task
          </button>
        </div>
      </div>

      {/* ── This Week Tasks ──────────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHeaderStatic}>
          <div className={styles.sectionTitle}>
            <span className={styles.sectionDotInfo} />
            This Week Tasks
          </div>
          <div className={styles.personToggle}>
            {ASSIGNEES.map(p => (
              <button
                key={p}
                className={`${styles.personBtn} ${weekPerson === p ? styles.personBtnActive : ''}`}
                onClick={() => setWeekPerson(prev => prev === p ? null : p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {weekPerson && (
          weekPersonTasks.length === 0 ? (
            <div className={styles.weekEmpty}>
              Δεν υπάρχουν tasks για τον <strong>{weekPerson}</strong> αυτή την εβδομάδα.
            </div>
          ) : (
            <div className={styles.todoGrid}>
              {weekPersonTasks.map(t => <TaskCard key={t.id} task={t} />)}
            </div>
          )
        )}
      </section>

      {/* ── To Do List ───────────────────────────────────────────────────── */}
      <section className={styles.section}>
        <button
          className={styles.sectionHeader}
          onClick={() => setTodoCollapsed(v => !v)}
        >
          <div className={styles.sectionTitle}>
            <span className={styles.sectionDot} />
            To Do List
            <span className={styles.sectionCount}>{todoCount}</span>
          </div>
          {todoCollapsed ? <ChevronDown size={16}/> : <ChevronUp size={16}/>}
        </button>

        {!todoCollapsed && (
          <>
            <div className={styles.catTabs}>
              <button
                className={`${styles.catTab} ${activeCatFilter === 'all' ? styles.catTabActive : ''}`}
                onClick={() => setActiveCatFilter('all')}
              >
                Όλα
              </button>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  className={`${styles.catTab} ${activeCatFilter === cat.id ? styles.catTabActive : ''}`}
                  onClick={() => setActiveCatFilter(cat.id)}
                >
                  {cat.name}
                </button>
              ))}
            </div>

            <div className={styles.todoGrid}>
              {filteredTodoTasks.length === 0 ? (
                <div className={styles.emptyState}>
                  <p>Δεν υπάρχουν tasks εδώ.</p>
                  <button className={styles.addBtnSmall} onClick={() => setAddingTask(true)}>
                    <Plus size={13}/> Πρόσθεσε task
                  </button>
                </div>
              ) : (
                filteredTodoTasks.map(t => <TodoTaskCard key={t.id} task={t} />)
              )}
            </div>
          </>
        )}
      </section>

      {/* ── POW Board ────────────────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHeaderStatic}>
          <div className={styles.sectionTitle}>
            <span className={styles.sectionDotPrimary} />
            POW Tasks — Week {currentWeek}
            <span className={styles.sectionCount}>{powTasks.length}</span>
          </div>
        </div>
        <PowBoard />
      </section>

      {addingTask && <TaskModal onClose={() => setAddingTask(false)} />}
    </div>
  );
}

export default function Pow() {
  return (
    <PowProvider>
      <PowInner />
    </PowProvider>
  );
}
