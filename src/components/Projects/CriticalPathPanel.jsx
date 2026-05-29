import { useMemo } from 'react';
import { computeCPM, getCriticalPath, getProjectDuration } from '../../utils/criticalPath.js';
import styles from './CriticalPathPanel.module.css';

const PHASE_STATUS_COLOR = {
  done:       '#00C896',
  inProgress: '#F5A623',
  notStarted: '#3a3a4a',
};

function FloatBar({ phase, projectDuration }) {
  const esW  = (phase.ES / projectDuration) * 100;
  const durW = (phase.duration / projectDuration) * 100;
  const floatW = (phase.float / projectDuration) * 100;

  return (
    <div className={styles.barWrap} title={`ES: Day ${phase.ES}  EF: Day ${phase.EF}  LS: Day ${phase.LS}  LF: Day ${phase.LF}  Float: ${phase.float}d`}>
      {/* spacer to push bar to ES position */}
      <div style={{ width: `${esW}%`, flexShrink: 0 }} />
      {/* work bar */}
      <div
        className={`${styles.workBar} ${phase.critical ? styles.workBarCritical : ''}`}
        style={{ width: `${Math.max(durW, 0.5)}%` }}
      />
      {/* float extension */}
      {phase.float > 0 && (
        <div className={styles.floatBar} style={{ width: `${Math.max(floatW, 0)}%` }} />
      )}
    </div>
  );
}

export default function CriticalPathPanel({ project }) {
  const phases   = project.phases || [];
  const cpmResult = useMemo(() => computeCPM(phases), [phases]);
  const critical  = getCriticalPath(cpmResult);
  const totalDays = getProjectDuration(cpmResult);

  if (phases.length === 0) {
    return (
      <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
        Add phases to see the critical path analysis.
      </p>
    );
  }

  const _missingDurations = cpmResult.filter((ph) => !ph.duration || ph.duration === 7 && !phases.find((p) => p.id === ph.id)?.duration);
  const hasDurations = phases.some((p) => p.duration);

  return (
    <div className={styles.panel}>
      {/* ── Summary strip ── */}
      <div className={styles.summary}>
        <div className={styles.summaryCard}>
          <span className={styles.summaryNum}>{totalDays}</span>
          <span className={styles.summaryLabel}>days minimum</span>
        </div>
        <div className={`${styles.summaryCard} ${styles.summaryCardCritical}`}>
          <span className={styles.summaryNum}>{critical.length}</span>
          <span className={styles.summaryLabel}>critical phases</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryNum}>{cpmResult.length - critical.length}</span>
          <span className={styles.summaryLabel}>phases with slack</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryNum}>
            {cpmResult.filter((p) => !p.critical).reduce((max, p) => Math.max(max, p.float), 0)}d
          </span>
          <span className={styles.summaryLabel}>max float</span>
        </div>
      </div>

      {!hasDurations && (
        <div className={styles.hint}>
          <span>💡</span>
          <span>Set <strong>Duration (days)</strong> on each phase (via the pencil icon) for accurate CPM. Currently using 7-day defaults.</span>
        </div>
      )}

      {/* ── Critical path chain ── */}
      {critical.length > 0 && (
        <div className={styles.cpChain}>
          <span className={styles.cpLabel}>Critical path:</span>
          {critical.map((ph, i) => (
            <span key={ph.id} className={styles.cpStep}>
              {i > 0 && <span className={styles.cpArrow}>→</span>}
              <span className={styles.cpName}>{ph.name}</span>
              <span className={styles.cpDays}>{ph.duration}d</span>
            </span>
          ))}
        </div>
      )}

      {/* ── Phase table ── */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Phase</th>
              <th className={styles.th} style={{ textAlign: 'center' }}>Dur</th>
              <th className={styles.th} style={{ textAlign: 'center' }}>ES</th>
              <th className={styles.th} style={{ textAlign: 'center' }}>EF</th>
              <th className={styles.th} style={{ textAlign: 'center' }}>LS</th>
              <th className={styles.th} style={{ textAlign: 'center' }}>LF</th>
              <th className={styles.th} style={{ textAlign: 'center' }}>Float</th>
              <th className={styles.th} style={{ width: '30%' }}>Timeline</th>
            </tr>
          </thead>
          <tbody>
            {cpmResult.map((ph) => (
              <tr key={ph.id} className={ph.critical ? styles.rowCritical : ''}>
                <td className={styles.td}>
                  <div className={styles.phaseName}>
                    <span
                      className={styles.statusDot}
                      style={{ background: PHASE_STATUS_COLOR[ph.status] || '#555' }}
                    />
                    <span>{ph.name}</span>
                    {ph.critical && <span className={styles.criticalTag}>CRITICAL</span>}
                  </div>
                </td>
                <td className={styles.tdNum}>{ph.duration}d</td>
                <td className={styles.tdNum}>{ph.ES}</td>
                <td className={styles.tdNum}>{ph.EF}</td>
                <td className={styles.tdNum}>{ph.LS}</td>
                <td className={styles.tdNum}>{ph.LF}</td>
                <td className={`${styles.tdNum} ${ph.critical ? styles.floatZero : styles.floatPos}`}>
                  {ph.float === 0 ? '0 ⚠' : `+${ph.float}`}
                </td>
                <td className={styles.td}>
                  <FloatBar phase={ph} projectDuration={totalDays} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Legend ── */}
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendSwatchCritical}`} /> Critical (float = 0)
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendSwatchFloat}`} /> Slack / float window
        </span>
        <span className={styles.legendDesc}>
          ES = Earliest Start · EF = Earliest Finish · LS = Latest Start · LF = Latest Finish · Float = available delay before impacting project end
        </span>
      </div>
    </div>
  );
}
