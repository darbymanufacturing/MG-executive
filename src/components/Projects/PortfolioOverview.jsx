import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { useProjects } from '../../context/ProjectContext.jsx';
import { daysSince, relativeLabel } from '../../utils/powHelpers.js';
import { STATUS_CONFIG, BLOCKER_TYPES } from './constants.js';
import styles from './PortfolioOverview.module.css';

// ── Tiny custom tooltip ──────────────────────────────────────────────────────
function SimpleTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-sm)',
      padding: '6px 10px',
      fontSize: 'var(--text-xs)',
    }}>
      {payload[0].name}: <strong>{payload[0].value}</strong>
    </div>
  );
}

export default function PortfolioOverview() {
  const navigate = useNavigate();
  const { activeProjects, archivedProjects } = useProjects();

  // ── 1. Health donut data ──────────────────────────────────────────────────
  const healthData = useMemo(() => {
    const counts = { blocked: 0, needsAttention: 0, onTrack: 0, archived: archivedProjects.length };
    activeProjects.forEach((p) => { counts[p.effectiveStatus] = (counts[p.effectiveStatus] || 0) + 1; });
    return [
      { name: 'Blocked',          value: counts.blocked,         color: STATUS_CONFIG.blocked.color },
      { name: 'Needs Attention',   value: counts.needsAttention,  color: STATUS_CONFIG.needsAttention.color },
      { name: 'On Track',          value: counts.onTrack,         color: STATUS_CONFIG.onTrack.color },
      { name: 'Archived',          value: counts.archived,        color: '#555555' },
    ].filter((d) => d.value > 0);
  }, [activeProjects, archivedProjects]);

  // ── 2. Phase-progress per project ────────────────────────────────────────
  const phaseData = useMemo(() => {
    return [...activeProjects]
      .map((p) => {
        const phases = p.phases || [];
        const done       = phases.filter((ph) => ph.status === 'done').length;
        const inProgress = phases.filter((ph) => ph.status === 'inProgress').length;
        const notStarted = phases.length - done - inProgress;
        const pct        = phases.length ? (done / phases.length) * 100 : 0;
        return { name: p.name, done, inProgress, notStarted, pct, _docId: p._docId };
      })
      .sort((a, b) => b.pct - a.pct);
  }, [activeProjects]);

  // ── 3. Blocker type pie ───────────────────────────────────────────────────
  const blockerData = useMemo(() => {
    const counts = {};
    activeProjects.forEach((p) => {
      (p.blockers || [])
        .filter((b) => !b.resolved)
        .forEach((b) => { counts[b.type] = (counts[b.type] || 0) + 1; });
    });
    return Object.entries(BLOCKER_TYPES)
      .map(([key, cfg]) => ({ name: cfg.label, value: counts[key] || 0, color: cfg.color }))
      .filter((d) => d.value > 0);
  }, [activeProjects]);

  // ── 4. Stale next-actions ─────────────────────────────────────────────────
  const staleProjects = useMemo(() => {
    return [...activeProjects]
      .filter((p) => p.nextAction?.text || p.updatedAt)
      .sort((a, b) => daysSince(b.updatedAt) - daysSince(a.updatedAt))
      .slice(0, 5);
  }, [activeProjects]);

  if (activeProjects.length === 0) return null;

  const totalProjects = activeProjects.length + archivedProjects.length;

  return (
    <div className={styles.overview}>

      {/* ── Row: Health Donut + Blocker Pie ──────────────────────────────── */}
      <div className={styles.row}>

        {/* Health Donut */}
        <div className={styles.tile}>
          <h3 className={styles.tileTitle}>Portfolio Health</h3>
          <p className={styles.tileSub}>{totalProjects} total projects</p>
          <div className={styles.donutWrap}>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie
                  data={healthData}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={70}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {healthData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<SimpleTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className={styles.donutCenter}>
              <span className={styles.donutNum}>{activeProjects.length}</span>
              <span className={styles.donutLabel}>active</span>
            </div>
          </div>
          <div className={styles.legend}>
            {healthData.map((d) => (
              <div key={d.name} className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: d.color }} />
                <span className={styles.legendText}>{d.name}</span>
                <span className={styles.legendVal}>{d.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Blockers Pie */}
        <div className={styles.tile}>
          <h3 className={styles.tileTitle}>Open Blockers by Type</h3>
          <p className={styles.tileSub}>
            {blockerData.reduce((s, d) => s + d.value, 0) === 0
              ? 'No active blockers'
              : `${blockerData.reduce((s, d) => s + d.value, 0)} unresolved`}
          </p>
          {blockerData.length > 0 ? (
            <>
              <div style={{ height: 160 }}>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie
                      data={blockerData}
                      cx="50%"
                      cy="50%"
                      outerRadius={65}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      {blockerData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<SimpleTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className={styles.legend}>
                {blockerData.map((d) => (
                  <div key={d.name} className={styles.legendItem}>
                    <span className={styles.legendDot} style={{ background: d.color }} />
                    <span className={styles.legendText}>{d.name}</span>
                    <span className={styles.legendVal}>{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className={styles.emptyPie}>
              <span style={{ fontSize: 32 }}>✅</span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>All clear</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Phase Progress Bars ───────────────────────────────────────────── */}
      {phaseData.length > 0 && (
        <div className={styles.tile} style={{ gridColumn: '1 / -1' }}>
          <h3 className={styles.tileTitle}>Phase Completion</h3>
          <p className={styles.tileSub}>Done / In Progress / Not Started · click to open</p>
          <div style={{ height: Math.max(120, phaseData.length * 36 + 30) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={phaseData}
                layout="vertical"
                margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
                onClick={(e) => {
                  if (e?.activePayload?.[0]?.payload?._docId) {
                    navigate(`/projects/${e.activePayload[0].payload._docId}`);
                  }
                }}
                style={{ cursor: 'pointer' }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={140}
                  tick={{ fontSize: 11, fill: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}
                  tickFormatter={(v) => v.length > 18 ? v.slice(0, 17) + '…' : v}
                />
                <Tooltip content={<SimpleTooltip />} />
                <Bar dataKey="done"       name="Done"        stackId="a" fill={STATUS_CONFIG.onTrack.color} radius={[0,0,0,0]} />
                <Bar dataKey="inProgress" name="In Progress" stackId="a" fill={STATUS_CONFIG.needsAttention.color} />
                <Bar dataKey="notStarted" name="Not Started"  stackId="a" fill="var(--color-border)" radius={[0,2,2,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className={styles.phaseLegend}>
            <span><span className={styles.legendDot} style={{ background: STATUS_CONFIG.onTrack.color }} />Done</span>
            <span><span className={styles.legendDot} style={{ background: STATUS_CONFIG.needsAttention.color }} />In Progress</span>
            <span><span className={styles.legendDot} style={{ background: 'var(--color-border)' }} />Not Started</span>
          </div>
        </div>
      )}

      {/* ── Stale Next-Actions ────────────────────────────────────────────── */}
      {staleProjects.length > 0 && (
        <div className={styles.tile} style={{ gridColumn: '1 / -1' }}>
          <h3 className={styles.tileTitle}>Next-Action Staleness</h3>
          <p className={styles.tileSub}>Projects sorted by days since last update</p>
          <div className={styles.staleList}>
            {staleProjects.map((p) => {
              const stale = daysSince(p.updatedAt);
              const chipColor = stale >= 14 ? 'var(--color-danger)'
                : stale >= 7 ? 'var(--color-warning)'
                : 'var(--color-text-muted)';
              const statusCfg = STATUS_CONFIG[p.effectiveStatus] || STATUS_CONFIG.onTrack;
              return (
                <div
                  key={p._docId}
                  className={styles.staleRow}
                  onClick={() => navigate(`/projects/${p._docId}`)}
                >
                  <span className={styles.staleDot} style={{ background: statusCfg.color }} />
                  <div className={styles.staleInfo}>
                    <span className={styles.staleName}>{p.name}</span>
                    <span className={styles.staleAction}>
                      {p.nextAction?.text || 'No next action set'}
                    </span>
                  </div>
                  <span className={styles.staleChip} style={{ color: chipColor }}>
                    {relativeLabel(p.updatedAt)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
