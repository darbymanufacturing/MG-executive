import { useMemo, useState } from 'react';
import { useTelemetry } from '../../../context/TelemetryContext.jsx';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import { fleetRiskRanking } from '../../../utils/pmeAnalyses.js';
import RiskBadge from '../shared/RiskBadge.jsx';
import styles from './Fleet.module.css';

export default function FleetRiskTable({ onSelectScooter }) {
  const { events } = useTelemetry();
  const { scooters, tickets } = useMaintenance();
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter]  = useState('all'); // all | high | medium | low

  const ranked = useMemo(
    () => fleetRiskRanking(events, tickets, scooters),
    [events, tickets, scooters],
  );

  // #264 — memoize pill counts instead of recomputing .length four times per render
  const counts = useMemo(() => ({
    all:    ranked.length,
    high:   ranked.filter((r) => r.risk === 'high').length,
    medium: ranked.filter((r) => r.risk === 'medium').length,
    low:    ranked.filter((r) => r.risk === 'low').length,
  }), [ranked]);

  const filtered = filter === 'all' ? ranked : ranked.filter((r) => r.risk === filter);
  const visible  = showAll ? filtered : filtered.slice(0, 10);

  if (!ranked.length) {
    return (
      <div className={styles.empty}>
        No scooter data loaded. Upload a Status Log CSV on the Ingest tab.
      </div>
    );
  }

  return (
    <div className={styles.riskTable}>
      <div className={styles.tableHeader}>
        <h3 className={styles.tableTitle}>Maintenance Priority Queue</h3>
        <div className={styles.filterPills}>
          {['all', 'high', 'medium', 'low'].map((f) => (
            <button
              key={f}
              className={`${styles.pill} ${filter === f ? styles.pillActive : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? `All (${counts.all})` : `${f.charAt(0).toUpperCase() + f.slice(1)} (${counts[f]})`}
            </button>
          ))}
        </div>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>#</th>
            <th>Scooter ID</th>
            <th>City</th>
            <th>Risk</th>
            <th>Score</th>
            <th>Overturn ×</th>
            <th>Repairs (30d)</th>
            <th>Days since svc</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row, i) => (
            <tr
              key={row.scooterId}
              className={`${styles.row} ${row.risk === 'high' ? styles.rowHigh : ''}`}
              onClick={() => onSelectScooter?.(row.scooterId)}
              style={{ cursor: onSelectScooter ? 'pointer' : 'default' }}
            >
              <td className={styles.rank}>{i + 1}</td>
              <td className={styles.scooterId}>{row.scooterId}</td>
              <td>{row.city || '—'}</td>
              <td><RiskBadge risk={row.risk} compact /></td>
              <td className={styles.score}>{(row.score * 100).toFixed(0)}</td>
              {/* #265 — use CSS tokens instead of hardcoded hex colors */}
              <td style={{ color: row.overturnRatio > 2 ? 'var(--color-danger)' : 'inherit' }}>
                {row.overturnRatio.toFixed(1)}×
              </td>
              <td style={{ color: row.recentRepairs > 0 ? 'var(--color-warning)' : 'inherit' }}>
                {row.recentRepairs}
              </td>
              <td>{Math.round(row.daysSinceService)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {filtered.length > 10 && (
        <button className={styles.showMore} onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show top 10' : `Show all ${filtered.length} scooters`}
        </button>
      )}
    </div>
  );
}
