import { useState } from 'react';
import { Plus, Eye, EyeOff, ChevronUp, ChevronDown } from 'lucide-react';
import { PowProvider, usePow } from '../context/PowContext.jsx';
import PowBoard from '../components/Pow/PowBoard.jsx';
import TaskCard from '../components/Pow/TaskCard.jsx';
import TaskModal from '../components/Pow/TaskModal.jsx';
import styles from './Pow.module.css';

function PowInner() {
  const {
    activeTasks, doneTasks, currentWeek,
    showDone, setShowDone,
    setCurrentWeek, loading,
  } = usePow();

  const [addingTask,    setAddingTask]    = useState(false);
  const [todoCollapsed, setTodoCollapsed] = useState(false);

  if (loading) {
    return (
      <div className={styles.loadingState}>
        <div className={styles.spinner} />
        <p>Φόρτωση tasks…</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div className={styles.titleBlock}>
          <h1 className={styles.pageTitle}>POW <span className={styles.titleAccent}>v3</span></h1>
          <p className={styles.subtitle}>Progress Of Week</p>
        </div>

        <div className={styles.headerControls}>
          {/* Week selector */}
          <div className={styles.weekControl}>
            <button className={styles.weekBtn} onClick={() => setCurrentWeek(currentWeek - 1)}>
              <ChevronDown size={14}/>
            </button>
            <span className={styles.weekLabel}>Week {currentWeek}</span>
            <button className={styles.weekBtn} onClick={() => setCurrentWeek(currentWeek + 1)}>
              <ChevronUp size={14}/>
            </button>
          </div>

          {/* Toggle done */}
          <button
            className={`${styles.toggleBtn} ${showDone ? styles.active : ''}`}
            onClick={() => setShowDone(v => !v)}
          >
            {showDone ? <Eye size={14}/> : <EyeOff size={14}/>}
            {showDone ? `Done (${doneTasks.length})` : 'Show Done'}
          </button>

          {/* Add task */}
          <button className={styles.addBtn} onClick={() => setAddingTask(true)}>
            <Plus size={15}/> New Task
          </button>
        </div>
      </div>

      {/* ── To Do List ───────────────────────────────────────────────────── */}
      <section className={styles.section}>
        <button
          className={styles.sectionHeader}
          onClick={() => setTodoCollapsed(v => !v)}
        >
          <div className={styles.sectionTitle}>
            <span className={styles.sectionDot} />
            To Do List
            <span className={styles.sectionCount}>{activeTasks.length}</span>
          </div>
          {todoCollapsed ? <ChevronDown size={16}/> : <ChevronUp size={16}/>}
        </button>

        {!todoCollapsed && (
          <div className={styles.todoGrid}>
            {activeTasks.length === 0 ? (
              <div className={styles.emptyState}>
                <p>Όλα έτοιμα! Δεν υπάρχουν pending tasks.</p>
                <button className={styles.addBtnSmall} onClick={() => setAddingTask(true)}>
                  <Plus size={13}/> Πρόσθεσε το πρώτο task
                </button>
              </div>
            ) : (
              activeTasks.map(t => <TaskCard key={t.id} task={t} />)
            )}
          </div>
        )}
      </section>

      {/* ── POW Board ────────────────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader} style={{ cursor: 'default' }}>
          <div className={styles.sectionTitle}>
            <span className={styles.sectionDotPrimary} />
            POW Tasks — Week {currentWeek}
          </div>
        </div>
        <PowBoard />
      </section>

      {/* ── Done this week (collapsible) ─────────────────────────────────── */}
      {showDone && doneTasks.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader} style={{ cursor: 'default' }}>
            <div className={styles.sectionTitle}>
              <span className={styles.sectionDotDone} />
              Done — Week {currentWeek}
              <span className={styles.sectionCount}>{doneTasks.length}</span>
            </div>
          </div>
          <div className={styles.todoGrid}>
            {doneTasks.map(t => <TaskCard key={t.id} task={t} />)}
          </div>
        </section>
      )}

      {/* Modal */}
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
