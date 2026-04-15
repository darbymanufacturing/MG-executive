import { useMemo } from 'react';
import { useTelemetry } from '../../../context/TelemetryContext.jsx';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import { trueOverturnsReport } from '../../../utils/pmeAnalyses.js';
import { validTickets } from '../../../utils/repairJunkFilter.js';
import styles from './Fleet.module.css';

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export default function OutlierCallouts({ onSelectScooter }) {
  const { events } = useTelemetry();
  const { tickets } = useMaintenance();

  const { overturnOutliers, repairOutliers } = useMemo(() => {
    const ovtReport = trueOverturnsReport(events);
    const good      = validTickets(tickets);

    // Overturn outliers (30d count > 2× median)
    const ovtCounts = ovtReport.map((r) => r.last30);
    const ovtMed    = median(ovtCounts);
    const ovtOutliers = ovtReport
      .filter((r) => r.last30 > Math.max(2, ovtMed * 2))
      .slice(0, 5);

    // Repair outliers (total repairs > 2× median)
    const repairMap = {};
    for (const t of good) {
      repairMap[t.scooterId] = (repairMap[t.scooterId] || 0) + 1;
    }
    const repCounts   = Object.values(repairMap);
    const repMed      = median(repCounts);
    const repOutliers = Object.entries(repairMap)
      .filter(([, n]) => n > Math.max(2, repMed * 2))
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([scooterId, count]) => ({ scooterId, count }));

    return { overturnOutliers: ovtOutliers, repairOutliers: repOutliers };
  }, [events, tickets]);

  if (!overturnOutliers.length && !repairOutliers.length) {
    return (
      <div className={styles.empty}>
        No outliers detected — fleet appears uniform. Upload more data to refine.
      </div>
    );
  }

  return (
    <div className={styles.outliers}>
      {overturnOutliers.length > 0 && (
        <div className={styles.outlierGroup}>
          <h4 className={styles.outlierTitle}>⚠ Overturn outliers (last 30 days)</h4>
          <div className={styles.outlierList}>
            {overturnOutliers.map((r) => (
              <div
                key={r.scooterId}
                className={styles.outlierCard}
                onClick={() => onSelectScooter?.(r.scooterId)}
              >
                <span className={styles.outlierScooterId}>{r.scooterId}</span>
                <span className={styles.outlierStat} style={{ color: '#E84545' }}>
                  {r.last30} overturns (30d)
                </span>
                <span className={styles.outlierSub}>{r.total} lifetime</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {repairOutliers.length > 0 && (
        <div className={styles.outlierGroup}>
          <h4 className={styles.outlierTitle}>🔧 High-repair outliers (lifetime)</h4>
          <div className={styles.outlierList}>
            {repairOutliers.map((r) => (
              <div
                key={r.scooterId}
                className={styles.outlierCard}
                onClick={() => onSelectScooter?.(r.scooterId)}
              >
                <span className={styles.outlierScooterId}>{r.scooterId}</span>
                <span className={styles.outlierStat} style={{ color: '#F5A623' }}>
                  {r.count} repairs
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
