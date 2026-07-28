import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Eye, EyeOff, ChevronUp, ChevronDown, Calendar, List, Columns, Zap, ClipboardList } from 'lucide-react';
import { PowProvider, usePow } from '../context/PowContext.jsx';
import PowBoard from '../components/Pow/PowBoard.jsx';
import TodoTaskCard from '../components/Pow/TodoTaskCard.jsx';
import TaskCard from '../components/Pow/TaskCard.jsx';
import TaskModal from '../components/Pow/TaskModal.jsx';
import EmptyState from '../components/Shared/EmptyState.jsx';
import styles from './Pow.module.css';

const ASSIGNEES = ['Panos', 'Kostas'];

// Week 1 = Nov 3, 2025 (Monday).
// #109 — Explicit Athens EET offset (UTC+2 in winter) so week boundaries are
// consistent regardless of the browser's local timezone.
const WEEK1_START = new Date('2025-11-03T00:00:00+02:00');

function getWeekRange(weekNumber) {
  const start = new Date(WEEK1_START);
  start.setDate(start.getDate() + (weekNumber - 1) * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d) => d.toLocaleDateString('el-GR', { day: 'numeric', month: 'short' });
  return `${fmt(start)} – ${fmt(end)}`;
}

function PowInner() {
  const { t } = useTranslation();
  const {
    categories, allTodoTasks, powTasks, doneTasks,
    currentWeek, showDone, setShowDone,
    setCurrentWeek, loading,
  } = usePow();

  const [addingTask,      setAddingTask]      = useState(false);
  const [activeCatFilter, setActiveCatFilter] = useState('all');
  const [weekPerson,      setWeekPerson]      = useState(null);
  const [activeTab,       setActiveTab]       = useState('week');

  if (loading) {
    return (
      <div className={styles.loadingState}>
        <div className={styles.spinner} />
        <p>{t('pow.loadingTasks')}</p>
      </div>
    );
  }

  const filteredTodoTasks = activeCatFilter === 'all'
    ? allTodoTasks
    : allTodoTasks.filter(t => t.categoryId === activeCatFilter);

  const todoCount = allTodoTasks.filter(t => t.status !== 'done').length;

  const getPersonTasks = (person) =>
    [...powTasks, ...(showDone ? doneTasks : [])].filter(t =>
      (t.assignees ?? []).includes(person) &&
      (t.powWeeks?.[person] ?? t.createdWeek) === currentWeek
    );

  // When no person selected, show all this-week tasks across both assignees
  const weekTasks = weekPerson
    ? getPersonTasks(weekPerson)
    : [...powTasks, ...(showDone ? doneTasks : [])].filter(t =>
        ASSIGNEES.some(p =>
          (t.assignees ?? []).includes(p) &&
          (t.powWeeks?.[p] ?? t.createdWeek) === currentWeek
        )
      );

  return (
    <div className={styles.page}>

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <h1 className={styles.pageTitle}>
            POW <span className={styles.titleAccent}>v3</span>
          </h1>
          <p className={styles.subtitle}>Progress Of Week</p>
        </div>

        <div className={styles.topBarRight}>
          <div className={styles.weekPill}>
            <button className={styles.weekBtn} onClick={() => setCurrentWeek(Math.max(1, currentWeek - 1))}>
              <ChevronDown size={13}/>
            </button>
            <div className={styles.weekInfo}>
              <span className={styles.weekLabel}>Week {currentWeek}</span>
              <span className={styles.weekDates}>{getWeekRange(currentWeek)}</span>
            </div>
            <button className={styles.weekBtn} onClick={() => setCurrentWeek(currentWeek + 1)}>
              <ChevronUp size={13}/>
            </button>
          </div>

          <button
            className={`${styles.toggleBtn} ${showDone ? styles.active : ''}`}
            onClick={() => setShowDone(v => !v)}
          >
            {showDone ? <Eye size={14}/> : <EyeOff size={14}/>}
            <span className={styles.toggleText}>
              {showDone ? `Done (${doneTasks.length})` : 'Done'}
            </span>
          </button>

          <button className={styles.addBtn} onClick={() => setAddingTask(true)}>
            <Plus size={15}/> <span className={styles.addBtnText}>New Task</span>
          </button>
        </div>
      </div>

      {/* ── SECTION: This Week ───────────────────────────────────────────── */}
      <section className={`${styles.section} ${activeTab !== 'week' ? styles.mobileHidden : ''}`}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>
            <span className={styles.dotInfo}/>
            This Week
            <span className={styles.sectionCount}>{weekTasks.length}</span>
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

        {weekTasks.length === 0 ? (
          <EmptyState
            icon={Zap}
            title={t('pow.weekEmptyTitle')}
            description={t('pow.weekEmptyDesc')}
          />
        ) : (
          <div className={styles.taskGrid}>
            {weekTasks.map(t => (
              <TaskCard key={t.id} task={t} assigneeContext={weekPerson} />
            ))}
          </div>
        )}
      </section>

      {/* ── SECTION: To Do / Backlog ─────────────────────────────────────── */}
      <section className={`${styles.section} ${activeTab !== 'backlog' ? styles.mobileHidden : ''}`}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>
            <span className={styles.dotWarning}/>
            To Do List
            <span className={styles.sectionCount}>{todoCount}</span>
          </div>
        </div>

        <div className={styles.catTabs}>
          <button
            className={`${styles.catTab} ${activeCatFilter === 'all' ? styles.catTabActive : ''}`}
            onClick={() => setActiveCatFilter('all')}
          >{t('pow.all')}</button>
          {categories.map(cat => (
            <button
              key={cat.id}
              className={`${styles.catTab} ${activeCatFilter === cat.id ? styles.catTabActive : ''}`}
              onClick={() => setActiveCatFilter(cat.id)}
            >{cat.name}</button>
          ))}
        </div>

        {filteredTodoTasks.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={t('pow.todoEmptyTitle')}
            description={t('pow.todoEmptyDesc')}
            action={
              <button className={styles.addBtnSmall} onClick={() => setAddingTask(true)}>
                <Plus size={13}/> {t('pow.addTask')}
              </button>
            }
          />
        ) : (
          <div className={styles.taskGrid}>
            {filteredTodoTasks.map(t => <TodoTaskCard key={t.id} task={t} />)}
          </div>
        )}
      </section>

      {/* ── SECTION: POW Board ───────────────────────────────────────────── */}
      <section className={`${styles.section} ${activeTab !== 'board' ? styles.mobileHidden : ''}`}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>
            <span className={styles.dotPrimary}/>
            POW Board — Week {currentWeek}
            <span className={styles.sectionCount}>{powTasks.length}</span>
          </div>
        </div>
        <PowBoard />
      </section>

      {/* ── Mobile bottom nav ────────────────────────────────────────────── */}
      <nav className={styles.bottomNav}>
        <button
          className={`${styles.navTab} ${activeTab === 'week' ? styles.navTabActive : ''}`}
          onClick={() => setActiveTab('week')}
        >
          <Calendar size={20}/>
          <span>This Week</span>
        </button>

        <button
          className={`${styles.navTab} ${activeTab === 'backlog' ? styles.navTabActive : ''}`}
          onClick={() => setActiveTab('backlog')}
        >
          <span className={styles.navTabInner}>
            <List size={20}/>
            {todoCount > 0 && <span className={styles.navBadge}>{todoCount}</span>}
          </span>
          <span>Backlog</span>
        </button>

        <button
          className={styles.navFab}
          onClick={() => setAddingTask(true)}
          aria-label="New Task"
        >
          <Plus size={22}/>
        </button>

        <button
          className={`${styles.navTab} ${activeTab === 'board' ? styles.navTabActive : ''}`}
          onClick={() => setActiveTab('board')}
        >
          <Columns size={20}/>
          <span>Board</span>
        </button>
      </nav>

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
