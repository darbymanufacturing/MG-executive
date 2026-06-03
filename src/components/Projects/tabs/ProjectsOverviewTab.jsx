import { useMemo } from 'react';
import { AlertTriangle, CheckSquare, Clock, TrendingUp } from 'lucide-react';
import { useProjects } from '../../../context/ProjectContext.jsx';
import styles from './ProjectsOverviewTab.module.css';

function daysUntil(dateStr) {
  if (!dateStr) return null;
  // Use Date.UTC on both sides to avoid UTC+2/+3 off-by-one:
  // new Date("YYYY-MM-DD") parses as midnight UTC, making the difference
  // wrong relative to local wall-clock date in Greece timezone.
  const [ty, tm, td] = dateStr.split('-').map(Number);
  const now = new Date();
  const target = Date.UTC(ty, tm - 1, td);
  const today  = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil((target - today) / 86400000);
}

function StatCard({ label, value, sub, color }) {
  return (
    <div className={styles.statCard} style={{ borderTopColor: color }}>
      <div className={styles.statValue} style={{ color }}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
      {sub && <div className={styles.statSub}>{sub}</div>}
    </div>
  );
}

export default function ProjectsOverviewTab() {
  const { activeProjects, gates } = useProjects();

  const counts = useMemo(() => ({
    green: activeProjects.filter((p) => p.status === 'Green').length,
    amber: activeProjects.filter((p) => p.status === 'Amber').length,
    red:   activeProjects.filter((p) => p.status === 'Red').length,
  }), [activeProjects]);

  const upcomingMilestones = useMemo(() => {
    const results = [];
    activeProjects.forEach((p) => {
      (p.milestones || []).forEach((m) => {
        if (m.done) return;
        const d = daysUntil(m.dueDate);
        if (d !== null && d <= 14) {
          results.push({ project: p.name, title: m.title, dueDate: m.dueDate, daysLeft: d, status: p.status });
        }
      });
    });
    return results.sort((a, b) => a.daysLeft - b.daysLeft);
  }, [activeProjects]);

  const activeBlockers = useMemo(() => {
    const results = [];
    activeProjects.forEach((p) => {
      (p.blockers || []).filter((b) => !b.resolved).forEach((b) => {
        results.push({ project: p.name, text: b.text, status: p.status });
      });
    });
    return results;
  }, [activeProjects]);

  const atRiskGates = gates.filter((g) => g.status === 'At Risk');

  return (
    <div className={styles.wrap}>
      {/* RAG summary */}
      <div className={styles.statRow}>
        <StatCard label="On Track" value={counts.green} sub="projects" color="#22c55e" />
        <StatCard label="At Risk"  value={counts.amber} sub="projects" color="#f59e0b" />
        <StatCard label="Blocked"  value={counts.red}   sub="projects" color="#ef4444" />
        <StatCard label="Total Active" value={activeProjects.length} sub="projects" color="var(--color-text-muted)" />
      </div>

      <div className={styles.panels}>
        {/* Upcoming milestones */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <Clock size={14} />
            <span>Milestones Due (next 14 days)</span>
          </div>
          {upcomingMilestones.length === 0 ? (
            <p className={styles.empty}>No milestones due soon.</p>
          ) : (
            <ul className={styles.itemList}>
              {upcomingMilestones.map((m, i) => (
                <li key={i} className={styles.listItem}>
                  <span className={`${styles.dot} ${styles[`dot${m.status}`]}`} />
                  <span className={styles.itemMain}>{m.title}</span>
                  <span className={styles.itemSub}>{m.project}</span>
                  <span className={`${styles.daysBadge} ${m.daysLeft < 0 ? styles.overdue : m.daysLeft <= 3 ? styles.urgent : ''}`}>
                    {m.daysLeft < 0 ? `${Math.abs(m.daysLeft)}d overdue` : `${m.daysLeft}d`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Active blockers */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <AlertTriangle size={14} />
            <span>Active Blockers</span>
            {activeBlockers.length > 0 && (
              <span className={styles.badge}>{activeBlockers.length}</span>
            )}
          </div>
          {activeBlockers.length === 0 ? (
            <p className={styles.empty}>No active blockers 🟢</p>
          ) : (
            <ul className={styles.itemList}>
              {activeBlockers.map((b, i) => (
                <li key={i} className={styles.listItem}>
                  <span className={`${styles.dot} ${styles[`dot${b.status}`]}`} />
                  <span className={styles.itemMain}>{b.text}</span>
                  <span className={styles.itemSub}>{b.project}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Decision gates at risk */}
        {atRiskGates.length > 0 && (
          <div className={`${styles.panel} ${styles.panelWide}`}>
            <div className={styles.panelHeader}>
              <TrendingUp size={14} />
              <span>Decision Gates — At Risk</span>
            </div>
            <ul className={styles.itemList}>
              {atRiskGates.map((g) => {
                const d = daysUntil(g.decisionDate);
                const pct = g.threshold ? Math.min(100, Math.round((g.currentValue / g.threshold) * 100)) : null;
                return (
                  <li key={g._docId} className={styles.listItem}>
                    <span className={styles.dot} style={{ background: '#f59e0b' }} />
                    <span className={styles.itemMain}>{g.name}</span>
                    {pct !== null && (
                      <span className={styles.itemSub}>{g.currentValue.toLocaleString()} / {g.threshold.toLocaleString()} {g.unit} ({pct}%)</span>
                    )}
                    {d !== null && (
                      <span className={styles.daysBadge}>{d > 0 ? `${d}d` : 'Due'}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* All clear message */}
        {activeProjects.length === 0 && (
          <div className={`${styles.panel} ${styles.panelWide}`}>
            <div className={styles.emptyState}>
              <CheckSquare size={32} style={{ opacity: 0.3 }} />
              <p>No projects yet. Add your first project to start tracking.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
