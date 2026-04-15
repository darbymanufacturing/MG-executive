import { useMemo } from 'react';
import { useTelemetry } from '../../../context/TelemetryContext.jsx';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import { overturnBaseline, fleetRiskRanking } from '../../../utils/pmeAnalyses.js';
import RiskBadge from '../shared/RiskBadge.jsx';
import styles from './Scooter.module.css';

const ACTIONS = {
  high:   'Preemptive service recommended',
  medium: 'Schedule inspection within 2 weeks',
  low:    'Continue normal operation',
};

export default function ScooterHealthCard({ scooterId }) {
  const { events } = useTelemetry();
  const { scooters, tickets } = useMaintenance();

  const { score, risk, baseline } = useMemo(() => {
    if (!scooterId) return { score: null, risk: null, baseline: null };
    const ranked  = fleetRiskRanking(events, tickets, scooters);
    const entry   = ranked.find((r) => r.scooterId === scooterId);
    const bl      = overturnBaseline(events, scooterId);
    return {
      score:    entry?.score ?? 0,
      risk:     entry?.risk  ?? 'low',
      baseline: bl,
    };
  }, [events, tickets, scooters, scooterId]);

  if (!scooterId) return null;

  const healthScore = Math.round((1 - (score ?? 0)) * 100);
  const scooter     = scooters.find((s) => s.scooterId === scooterId);

  return (
    <div className={styles.healthCard}>
      <div className={styles.healthTop}>
        <div>
          <div className={styles.healthScooterLabel}>Scooter {scooterId}</div>
          {scooter && (
            <div className={styles.healthMeta}>
              {scooter.model} · {scooter.city} · {scooter.status}
            </div>
          )}
        </div>
        <RiskBadge risk={risk} />
      </div>

      {/* Health score gauge */}
      <div className={styles.gaugeRow}>
        <div className={styles.gaugeTrack}>
          <div
            className={styles.gaugeFill}
            style={{
              width: `${healthScore}%`,
              background: healthScore >= 70 ? '#00C896' : healthScore >= 40 ? '#F5A623' : '#E84545',
            }}
          />
        </div>
        <span
          className={styles.gaugeScore}
          style={{ color: healthScore >= 70 ? '#00C896' : healthScore >= 40 ? '#F5A623' : '#E84545' }}
        >
          {healthScore}
        </span>
        <span className={styles.gaugeLabel}>Health Score</span>
      </div>

      {/* Overturn baseline */}
      {baseline && (
        <div className={styles.baselineRow}>
          <span className={styles.baselineKey}>30-day overturn rate</span>
          <span
            className={styles.baselineVal}
            style={{ color: baseline.anomaly ? '#E84545' : baseline.ratio > 1.5 ? '#F5A623' : '#00C896' }}
          >
            {baseline.ratio}× baseline
            {baseline.anomaly && ' ⚠'}
          </span>
        </div>
      )}

      {/* Recommended action */}
      <div className={styles.actionBox}>
        <span className={styles.actionLabel}>Recommended action</span>
        <span className={styles.actionText}>{ACTIONS[risk] || ACTIONS.low}</span>
      </div>

      {/* Days until predicted repair */}
      {baseline && baseline.last30Rate > 0 && (
        <div className={styles.predRow}>
          <span className={styles.predLabel}>Est. days until next repair</span>
          <span className={styles.predVal}>
            {Math.round(Math.max(7, 30 / (baseline.ratio || 1)))}d
          </span>
        </div>
      )}
    </div>
  );
}
