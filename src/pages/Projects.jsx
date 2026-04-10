import { useState } from 'react';
import { LayoutDashboard, List, GitMerge } from 'lucide-react';
import Header from '../components/Layout/Header.jsx';
import ProjectsOverviewTab from '../components/Projects/tabs/ProjectsOverviewTab.jsx';
import ProjectsListTab     from '../components/Projects/tabs/ProjectsListTab.jsx';
import DecisionGatesTab    from '../components/Projects/tabs/DecisionGatesTab.jsx';
import { useProjects }     from '../context/ProjectContext.jsx';
import styles from './Projects.module.css';

const TABS = [
  { id: 'overview', label: 'Overview',        icon: LayoutDashboard },
  { id: 'projects', label: 'Projects',        icon: List },
  { id: 'gates',    label: 'Decision Gates',  icon: GitMerge },
];

export default function Projects() {
  const [activeTab, setActiveTab] = useState('overview');
  const { activeProjects } = useProjects();

  const red   = activeProjects.filter((p) => p.status === 'Red').length;
  const amber = activeProjects.filter((p) => p.status === 'Amber').length;

  return (
    <div className={styles.page}>
      <Header
        title="Projects"
        subtitle="XSlide initiative tracker — RAG status, milestones &amp; decision gates"
        actions={
          <div className={styles.ragSummary}>
            {red   > 0 && <span className={styles.ragPill} style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>🔴 {red} blocked</span>}
            {amber > 0 && <span className={styles.ragPill} style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>🟡 {amber} at risk</span>}
            {red === 0 && amber === 0 && activeProjects.length > 0 && (
              <span className={styles.ragPill} style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>🟢 All on track</span>
            )}
          </div>
        }
      />

      <div className={styles.content}>
        <div className={styles.tabs}>
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`${styles.tab} ${activeTab === id ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(id)}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        <div className={styles.tabContent}>
          {activeTab === 'overview' && <ProjectsOverviewTab />}
          {activeTab === 'projects' && <ProjectsListTab />}
          {activeTab === 'gates'    && <DecisionGatesTab />}
        </div>
      </div>
    </div>
  );
}
