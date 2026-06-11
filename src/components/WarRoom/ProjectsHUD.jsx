import { useState } from 'react';
import { ChevronLeft, ChevronRight, LayoutDashboard, List, GitMerge } from 'lucide-react';
import { useProjects } from '../../context/ProjectContext.jsx';
import ProjectsOverviewTab from '../Projects/tabs/ProjectsOverviewTab.jsx';
import ProjectsListTab     from '../Projects/tabs/ProjectsListTab.jsx';
import DecisionGatesTab    from '../Projects/tabs/DecisionGatesTab.jsx';
import styles from './ProjectsHUD.module.css';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'projects', label: 'Projects', icon: List },
  { id: 'gates',    label: 'Gates',    icon: GitMerge },
];

export default function ProjectsHUD() {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const { activeProjects } = useProjects();

  const red   = activeProjects.filter((p) => p.status === 'blocked').length;
  const amber = activeProjects.filter((p) => p.status === 'needsAttention').length;
  const green = activeProjects.filter((p) => p.status === 'onTrack').length;

  if (collapsed) {
    return (
      <div className={`${styles.panel} ${styles.collapsed}`}>
        <button
          className={styles.collapseBtn}
          onClick={() => setCollapsed(false)}
          style={{ padding: '10px 0', width: '100%' }}
          title="Expand Operations panel"
        >
          <ChevronRight size={16} />
        </button>
        <div className={styles.collapsedStub}>
          <span className={styles.collapsedLabel}>Operations</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <span className={styles.headerTitle}>Operations</span>
        <div className={styles.ragRow}>
          {red   > 0 && <span className={styles.ragPill} style={{ background: 'rgba(239,68,68,0.15)',  color: '#ef4444' }}>🔴 {red}</span>}
          {amber > 0 && <span className={styles.ragPill} style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>🟡 {amber}</span>}
          {green > 0 && <span className={styles.ragPill} style={{ background: 'rgba(34,197,94,0.15)',  color: '#22c55e' }}>🟢 {green}</span>}
        </div>
        <button
          className={styles.collapseBtn}
          onClick={() => setCollapsed(true)}
          title="Collapse panel"
        >
          <ChevronLeft size={14} />
        </button>
      </div>

      {/* ── Tab bar ── */}
      <div className={styles.tabBar}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`${styles.tab} ${activeTab === id ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(id)}
          >
            <Icon size={11} />
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div className={styles.body}>
        {activeTab === 'overview' && <ProjectsOverviewTab />}
        {activeTab === 'projects' && <ProjectsListTab />}
        {activeTab === 'gates'    && <DecisionGatesTab />}
      </div>
    </div>
  );
}
