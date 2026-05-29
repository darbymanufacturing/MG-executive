import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { Plus, Calendar, Lightbulb, FolderKanban, CheckSquare, BarChart2 } from 'lucide-react';
import { useProjects } from '../../context/ProjectContext.jsx';
import { isPowDay, daysSince, relativeLabel } from '../../utils/powHelpers.js';
import { FILTER_OPTIONS } from './constants.js';
import ProjectCard from './ProjectCard.jsx';
import PortfolioOverview from './PortfolioOverview.jsx';
import NewProjectModal from './NewProjectModal.jsx';
import Brainstorm from './Brainstorm.jsx';
import ChecklistTab from './tabs/ChecklistTab.jsx';
import Skeleton from '../Shared/Skeleton.jsx';
import EmptyState from '../Shared/EmptyState.jsx';
const CalendarTab = lazy(() => import('./tabs/CalendarTab.jsx'));
const TimelineTab = lazy(() => import('./tabs/TimelineTab.jsx'));
import styles from './ProjectsDashboard.module.css';

/** Sort order: Blocked → needsAttention → onTrack → archived */
function sortProjects(projects) {
  const order = { blocked: 0, needsAttention: 1, onTrack: 2 };
  return [...projects].sort((a, b) => {
    const aO = order[a.effectiveStatus] ?? 3;
    const bO = order[b.effectiveStatus] ?? 3;
    return aO - bO;
  });
}

export default function ProjectsDashboard() {
  const { activeProjects, archivedProjects, loading } = useProjects();
  const [tab, setTab] = useState('projects');
  const [filter, setFilter] = useState('all');
  const [showNew, setShowNew] = useState(false);
  const [lastReviewedAt, setLastReviewedAt] = useState(null);

  // Stamp last-reviewed on mount
  useEffect(() => {
    const stored = localStorage.getItem('projects_lastReviewed');
    setLastReviewedAt(stored || null);
    localStorage.setItem('projects_lastReviewed', new Date().toISOString());
  }, []);

  const getFilteredProjects = useCallback(() => {
    if (filter === 'archived') return sortProjects(archivedProjects);
    const base = filter === 'all'
      ? activeProjects
      : activeProjects.filter((p) => p.effectiveStatus === filter);
    return sortProjects(base);
  }, [filter, activeProjects, archivedProjects]);

  const filtered = getFilteredProjects();
  const powDay = isPowDay();
  const daysSinceReview = lastReviewedAt ? daysSince(lastReviewedAt) : null;
  const reviewStale = daysSinceReview !== null && daysSinceReview >= 7;

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.grid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height="170px" radius="var(--radius-lg)" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* POW day banner */}
      {powDay && (
        <div className={styles.powBanner}>
          <div className={styles.powBannerText}>
            <span style={{ fontSize: 20 }}>📋</span>
            <div>
              <p className={styles.powBannerTitle}>Today is POW day</p>
              <p className={styles.powBannerSub}>Log your Progress of Week entries before closing the app.</p>
            </div>
          </div>
          <Calendar size={20} color="#00C896" />
        </div>
      )}

      {/* Header */}
      <div className={styles.header}>
        <h1 className={styles.title}>Projects</h1>
        <div className={styles.headerRight}>
          {lastReviewedAt && tab === 'projects' && (
            <span className={`${styles.lastReviewed} ${reviewStale ? styles.lastReviewedAmber : ''}`}>
              Last reviewed: {relativeLabel(lastReviewedAt)}
            </span>
          )}
          {tab === 'projects' && (
            <button className={styles.newBtn} onClick={() => setShowNew(true)}>
              <Plus size={16} /> New Project
            </button>
          )}
        </div>
      </div>

      {/* Module tabs */}
      <div className={styles.moduleTabs}>
        <button
          className={`${styles.moduleTab} ${tab === 'projects' ? styles.moduleTabActive : ''}`}
          onClick={() => setTab('projects')}
        >
          <FolderKanban size={14} /> Projects
        </button>
        <button
          className={`${styles.moduleTab} ${tab === 'checklist' ? styles.moduleTabActive : ''}`}
          onClick={() => setTab('checklist')}
        >
          <CheckSquare size={14} /> Checklist
        </button>
        <button
          className={`${styles.moduleTab} ${tab === 'calendar' ? styles.moduleTabActive : ''}`}
          onClick={() => setTab('calendar')}
        >
          <Calendar size={14} /> Calendar
        </button>
        <button
          className={`${styles.moduleTab} ${tab === 'timeline' ? styles.moduleTabActive : ''}`}
          onClick={() => setTab('timeline')}
        >
          <BarChart2 size={14} /> Timeline
        </button>
        <button
          className={`${styles.moduleTab} ${tab === 'brainstorm' ? styles.moduleTabActive : ''}`}
          onClick={() => setTab('brainstorm')}
        >
          <Lightbulb size={14} /> Brainstorm
        </button>
      </div>

      {tab === 'brainstorm' ? (
        <Brainstorm />
      ) : tab === 'checklist' ? (
        <ChecklistTab />
      ) : tab === 'calendar' ? (
        <Suspense fallback={<Skeleton height="320px" radius="var(--radius-lg)" />}>
          <CalendarTab />
        </Suspense>
      ) : tab === 'timeline' ? (
        <Suspense fallback={<Skeleton height="320px" radius="var(--radius-lg)" />}>
          <TimelineTab />
        </Suspense>
      ) : (
        <>
          {/* Filter pills */}
          <div className={styles.filters}>
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`${styles.filterPill} ${filter === opt.value ? styles.active : ''}`}
                onClick={() => setFilter(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Portfolio Overview strip */}
          <PortfolioOverview />

          {/* Card grid */}
          {filtered.length === 0 ? (
            <EmptyState
              icon={FolderKanban}
              title="No projects here"
              description="Create your first project or change the filter."
            />
          ) : (
            <div className={styles.grid}>
              {filtered.map((project) => (
                <ProjectCard key={project._docId} project={project} />
              ))}
            </div>
          )}
        </>
      )}

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} />}
    </div>
  );
}
