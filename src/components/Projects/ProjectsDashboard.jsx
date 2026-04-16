import { useState, useEffect, useCallback } from 'react';
import { Plus, Calendar, Lightbulb, FolderKanban } from 'lucide-react';
import { useProjects } from '../../context/ProjectContext.jsx';
import { isPowDay, daysSince, relativeLabel } from '../../utils/powHelpers.js';
import { FILTER_OPTIONS } from './constants.js';
import ProjectCard from './ProjectCard.jsx';
import PortfolioOverview from './PortfolioOverview.jsx';
import NewProjectModal from './NewProjectModal.jsx';
import Brainstorm from './Brainstorm.jsx';
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
    return <div className={styles.loading}>Loading projects…</div>;
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
          className={`${styles.moduleTab} ${tab === 'brainstorm' ? styles.moduleTabActive : ''}`}
          onClick={() => setTab('brainstorm')}
        >
          <Lightbulb size={14} /> Brainstorm
        </button>
      </div>

      {tab === 'brainstorm' ? (
        <Brainstorm />
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
          <div className={styles.grid}>
            {filtered.length === 0 ? (
              <div className={styles.emptyState}>
                <p className={styles.emptyStateTitle}>No projects here</p>
                <p>Create your first project or change the filter.</p>
              </div>
            ) : (
              filtered.map((project) => (
                <ProjectCard key={project._docId} project={project} />
              ))
            )}
          </div>
        </>
      )}

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} />}
    </div>
  );
}
