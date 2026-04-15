import { useMemo } from 'react';
import { useTelemetry } from '../../../context/TelemetryContext.jsx';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import { weeklyDigest, fleetRiskRanking } from '../../../utils/pmeAnalyses.js';
import RiskBadge from '../shared/RiskBadge.jsx';
import styles from './Reports.module.css';

function Delta({ now, prev, reverse = false }) {
  const diff = now - prev;
  if (diff === 0) return <span className={styles.delta}>→ no change</span>;
  const up    = diff > 0;
  const color = reverse ? (up ? '#E84545' : '#00C896') : (up ? '#00C896' : '#E84545');
  return (
    <span className={styles.delta} style={{ color }}>
      {up ? '▲' : '▼'} {Math.abs(diff)}
    </span>
  );
}

export default function WeeklyDigest() {
  const { events } = useTelemetry();
  const { tickets, scooters } = useMaintenance();

  const { thisWeek, lastWeek } = useMemo(
    () => weeklyDigest(events, tickets),
    [events, tickets],
  );

  const highRisk = useMemo(
    () => fleetRiskRanking(events, tickets, scooters).filter((r) => r.risk === 'high'),
    [events, tickets, scooters],
  );

  const weekLabel = (() => {
    const now    = new Date();
    const mon    = new Date(now);
    mon.setDate(now.getDate() - now.getDay() + 1);
    return mon.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  })();

  return (
    <div className={styles.digest}>
      <div className={styles.digestHeader}>
        <h3 className={styles.digestTitle}>Weekly Digest</h3>
        <span className={styles.digestWeek}>Week of {weekLabel}</span>
      </div>

      <div className={styles.digestGrid}>
        <div className={styles.digestCard}>
          <span className={styles.digestCardLabel}>Trips this week</span>
          <span className={styles.digestCardValue}>{thisWeek.trips.toLocaleString()}</span>
          <Delta now={thisWeek.trips} prev={lastWeek.trips} />
        </div>
        <div className={styles.digestCard}>
          <span className={styles.digestCardLabel}>True overturns</span>
          <span className={styles.digestCardValue}>{thisWeek.overturns}</span>
          <Delta now={thisWeek.overturns} prev={lastWeek.overturns} reverse />
        </div>
        <div className={styles.digestCard}>
          <span className={styles.digestCardLabel}>New repairs</span>
          <span className={styles.digestCardValue}>{thisWeek.repairs}</span>
          <Delta now={thisWeek.repairs} prev={lastWeek.repairs} reverse />
        </div>
      </div>

      {highRisk.length > 0 && (
        <div className={styles.digestSection}>
          <h4 className={styles.digestSectionTitle}>⚠ Act on this week</h4>
          <div className={styles.digestActionList}>
            {highRisk.slice(0, 5).map((r) => (
              <div key={r.scooterId} className={styles.digestActionRow}>
                <RiskBadge risk="high" compact />
                <span className={styles.digestActionId}>{r.scooterId}</span>
                <span className={styles.digestActionCity}>{r.city}</span>
                <span className={styles.digestActionNote}>Preemptive inspection recommended</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {highRisk.length === 0 && (
        <div className={styles.digestOk}>
          ✓ No high-risk scooters detected this week. Fleet looks healthy.
        </div>
      )}
    </div>
  );
}
