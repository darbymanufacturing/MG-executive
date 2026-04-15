import { useMemo } from 'react';
import { useTelemetry } from '../../../context/TelemetryContext.jsx';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import { overturnBaseline, overturnToRepairCorrelation } from '../../../utils/pmeAnalyses.js';
import styles from './Scooter.module.css';

export default function AnomalyFlags({ scooterId }) {
  const { events } = useTelemetry();
  const { tickets, scooters } = useMaintenance();

  const flags = useMemo(() => {
    if (!scooterId) return [];
    const result  = [];
    const bl      = overturnBaseline(events, scooterId);

    if (bl.anomaly) {
      result.push({
        severity: 'high',
        text: `Overturn rate is ${bl.ratio}× this scooter's lifetime baseline in the last 30 days (${bl.last30Count} overturns vs ${(bl.lifetimeMean * 30).toFixed(1)} expected).`,
      });
    } else if (bl.ratio > 1.5) {
      result.push({
        severity: 'medium',
        text: `Overturn rate is elevated: ${bl.ratio}× baseline in the last 30 days.`,
      });
    }

    // Correlation signal
    const { perScooter } = overturnToRepairCorrelation(events, tickets);
    const sc = perScooter.find((p) => p.scooterId === scooterId);
    if (sc && sc.overturns > 5 && sc.repairs > 3) {
      const ratio = sc.repairs / Math.max(1, sc.overturns);
      if (ratio > 0.5) {
        result.push({
          severity: 'medium',
          text: `High overturn-to-repair ratio: ${sc.repairs} repairs from ${sc.overturns} overturns lifetime (${(ratio * 100).toFixed(0)}% conversion rate).`,
        });
      }
    }

    // No events at all
    const scooterEvents = events.filter((e) => e.scooterId === scooterId);
    if (!scooterEvents.length) {
      result.push({
        severity: 'info',
        text: 'No status log events found. Upload data on the Ingest tab.',
      });
    }

    return result;
  }, [events, tickets, scooterId]);

  if (!scooterId) return null;

  return (
    <div className={styles.anomalyList}>
      <h4 className={styles.sectionTitle}>Anomaly Flags</h4>
      {!flags.length ? (
        <p className={styles.noAnomaly}>✓ No anomalies detected for this scooter.</p>
      ) : (
        flags.map((f, i) => (
          <div key={i} className={`${styles.anomalyItem} ${styles[`anomaly_${f.severity}`]}`}>
            <span className={styles.anomalyIcon}>
              {f.severity === 'high' ? '🔴' : f.severity === 'medium' ? '🟡' : 'ℹ️'}
            </span>
            <span>{f.text}</span>
          </div>
        ))
      )}
    </div>
  );
}
