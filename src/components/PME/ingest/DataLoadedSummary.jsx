import { useMemo } from 'react';
import { Database, Calendar } from 'lucide-react';
import { useTelemetry } from '../../../context/TelemetryContext.jsx';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import styles from './DataLoadedSummary.module.css';

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function DataLoadedSummary() {
  const { events }   = useTelemetry();
  const { scooters } = useMaintenance();

  const summary = useMemo(() => {
    if (!events.length) return null;

    const byScooter = {};
    for (const ev of events) {
      const id = ev.scooterId || '(unknown)';
      if (!byScooter[id]) {
        byScooter[id] = { count: 0, first: ev.timestamp, last: ev.timestamp };
      }
      byScooter[id].count++;
      if (ev.timestamp < byScooter[id].first) byScooter[id].first = ev.timestamp;
      if (ev.timestamp > byScooter[id].last)  byScooter[id].last  = ev.timestamp;
    }

    // Global date range across all events
    let globalFirst = events[0].timestamp;
    let globalLast  = events[0].timestamp;
    for (const ev of events) {
      if (ev.timestamp < globalFirst) globalFirst = ev.timestamp;
      if (ev.timestamp > globalLast)  globalLast  = ev.timestamp;
    }

    // Attach city/model from scooters registry
    const rows = Object.entries(byScooter)
      .map(([scooterId, d]) => {
        const sc = scooters.find((s) => s.scooterId === scooterId);
        return {
          scooterId,
          city:  sc?.city  || '—',
          model: sc?.model || '—',
          count: d.count,
          first: d.first,
          last:  d.last,
        };
      })
      .sort((a, b) => b.count - a.count);

    return { rows, globalFirst, globalLast, total: events.length };
  }, [events, scooters]);

  if (!summary) {
    return (
      <div className={styles.card}>
        <div className={styles.header}>
          <Database size={15} />
          <h3 className={styles.title}>Data Loaded</h3>
        </div>
        <p className={styles.empty}>
          No telemetry events in the database yet. Upload a Status Log CSV above to get started.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <Database size={15} />
        <h3 className={styles.title}>Data Loaded</h3>
        <span className={styles.pill}>
          {summary.total.toLocaleString()} events · {summary.rows.length} scooter{summary.rows.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className={styles.rangeRow}>
        <Calendar size={13} />
        <span>
          Coverage: <strong>{fmtDate(summary.globalFirst)}</strong>
          {' → '}
          <strong>{fmtDate(summary.globalLast)}</strong>
        </span>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Scooter</th>
              <th>City</th>
              <th>Model</th>
              <th className={styles.numCol}>Events</th>
              <th>Earliest</th>
              <th>Latest</th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((r) => (
              <tr key={r.scooterId}>
                <td><strong>{r.scooterId}</strong></td>
                <td>{r.city}</td>
                <td>{r.model}</td>
                <td className={styles.numCol}>{r.count.toLocaleString()}</td>
                <td>{fmtDate(r.first)}</td>
                <td>{fmtDate(r.last)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
