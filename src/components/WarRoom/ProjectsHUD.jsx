import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useProjects } from '../../context/ProjectContext.jsx';
import styles from './ProjectsHUD.module.css';

const STATUS_COLOR = { Green: '#22c55e', Amber: '#f59e0b', Red: '#ef4444' };

function ProjectRow({ project }) {
  const [expanded, setExpanded] = useState(false);
  const total     = project.milestones?.length || 0;
  const done      = project.milestones?.filter((m) => m.done).length || 0;
  const pct       = total > 0 ? (done / total) * 100 : 0;
  const blockers  = (project.blockers || []).filter((b) => !b.resolved);
  const color     = STATUS_COLOR[project.status] || '#888';

  return (
    <div
      className={styles.projectCard}
      style={{ borderLeftColor: color }}
      onClick={() => setExpanded((v) => !v)}
    >
      <div className={styles.projectTop}>
        <span className={styles.projectName}>{project.name}</span>
        <span className={styles.projectCat}>{project.category}</span>
      </div>

      {total > 0 && (
        <>
          <div className={styles.milestoneBar}>
            <div
              className={styles.milestoneBarFill}
              style={{ width: `${pct}%`, background: color }}
            />
          </div>
          <span className={styles.milestoneMeta}>{done}/{total} milestones</span>
        </>
      )}

      {expanded && blockers.length > 0 && (
        <div className={styles.projectExpanded}>
          {blockers.slice(0, 3).map((b) => (
            <div key={b.id} className={styles.blocker}>
              <span className={styles.blockerDot} />
              {b.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GateRow({ gate }) {
  const pct     = gate.threshold > 0
    ? Math.min(100, (gate.currentValue / gate.threshold) * 100)
    : 0;
  const color   = pct >= 100 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444';
  const days    = gate.decisionDate
    ? Math.ceil((new Date(gate.decisionDate) - new Date()) / 86400000)
    : null;

  return (
    <div className={styles.gateCard}>
      <span className={styles.gateName}>{gate.name}</span>
      <div className={styles.gateProgress}>
        <div
          className={styles.gateProgressFill}
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <div className={styles.gateMeta}>
        <span>{gate.currentValue?.toLocaleString()} / {gate.threshold?.toLocaleString()} {gate.unit}</span>
        {days !== null && (
          <span style={{ color: days <= 14 ? '#f59e0b' : 'inherit' }}>
            {days > 0 ? `${days}d left` : 'Overdue'}
          </span>
        )}
      </div>
    </div>
  );
}

export default function ProjectsHUD() {
  const [collapsed, setCollapsed] = useState(false);
  const { activeProjects, gates }  = useProjects();

  const red   = activeProjects.filter((p) => p.status === 'Red').length;
  const amber = activeProjects.filter((p) => p.status === 'Amber').length;
  const green = activeProjects.filter((p) => p.status === 'Green').length;

  // Sort: Red → Amber → Green
  const sorted = [...activeProjects].sort((a, b) => {
    const order = { Red: 0, Amber: 1, Green: 2 };
    return (order[a.status] ?? 3) - (order[b.status] ?? 3);
  });

  if (collapsed) {
    return (
      <div className={`${styles.panel} ${styles.collapsed}`}>
        <button className={styles.collapseBtn} onClick={() => setCollapsed(false)} style={{ padding: '10px 0', width: '100%' }}>
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
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.headerTitle}>Operations</span>
        <div className={styles.ragRow}>
          {red   > 0 && <span className={styles.ragPill} style={{ background: 'rgba(239,68,68,0.15)',  color: '#ef4444' }}>🔴 {red}</span>}
          {amber > 0 && <span className={styles.ragPill} style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>🟡 {amber}</span>}
          {green > 0 && <span className={styles.ragPill} style={{ background: 'rgba(34,197,94,0.15)',  color: '#22c55e' }}>🟢 {green}</span>}
        </div>
        <button className={styles.collapseBtn} onClick={() => setCollapsed(true)}>
          <ChevronLeft size={14} />
        </button>
      </div>

      {/* Body */}
      <div className={styles.body}>
        {/* Projects */}
        <span className={styles.sectionLabel}>Active Projects</span>
        {sorted.length === 0
          ? <p className={styles.empty}>No active projects.<br />Add one from the Projects module.</p>
          : sorted.map((p) => <ProjectRow key={p._docId} project={p} />)
        }

        {/* Decision Gates */}
        {gates.length > 0 && (
          <>
            <div className={styles.divider} />
            <span className={styles.sectionLabel}>Decision Gates</span>
            {gates.map((g) => <GateRow key={g._docId} gate={g} />)}
          </>
        )}
      </div>
    </div>
  );
}
