import { useMemo } from 'react';
import { useTelemetry } from '../../../context/TelemetryContext.jsx';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import { downtimeByCause, countRealTrips } from '../../../utils/pmeAnalyses.js';
import { validTickets } from '../../../utils/repairJunkFilter.js';
import { isTrueOverturn } from '../../../utils/classifyEventType.js';
import styles from './Scooter.module.css';

function StatRow({ label, value, sub }) {
  return (
    <div className={styles.statRow}>
      <span className={styles.statLabel}>{label}</span>
      <div className={styles.statRight}>
        <span className={styles.statValue}>{value}</span>
        {sub && <span className={styles.statSub}>{sub}</span>}
      </div>
    </div>
  );
}

export default function ScooterLifetimeStats({ scooterId }) {
  const { events } = useTelemetry();
  const { tickets } = useMaintenance();

  const stats = useMemo(() => {
    if (!scooterId) return null;
    const scooterEvents = events.filter((e) => e.scooterId === scooterId);
    const good          = validTickets(tickets).filter((t) => t.scooterId === scooterId);

    const trips         = countRealTrips(scooterEvents);
    // allOverturns: raw count via eventType OR direct afterState check (same robustness as isTrueOverturn)
    const allOverturns  = scooterEvents.filter(
      (e) => e.eventType === 'overturned' ||
             (e.afterState || '').toLowerCase().includes('overturn') ||
             (e.afterState || '').toLowerCase().includes('fallen'),
    ).length;
    const trueOvts      = scooterEvents.filter(isTrueOverturn).length;
    const rebalanceOvts = allOverturns - trueOvts;

    const dt            = downtimeByCause(scooterEvents);
    const repairs       = good.length;

    const completedRepairs = good.filter((t) => t.dateCompleted);
    const avgRepairDays    = completedRepairs.length
      ? +(completedRepairs.reduce((s, t) => {
          const diff = (new Date(t.dateCompleted) - new Date(t.dateEntered)) / 86_400_000;
          return s + Math.max(0, diff);
        }, 0) / completedRepairs.length).toFixed(1)
      : null;

    return { trips, trueOvts, rebalanceOvts, allOverturns, repairs, dt, avgRepairDays };
  }, [events, tickets, scooterId]);

  if (!scooterId || !stats) return null;

  return (
    <div className={styles.lifetimeStats}>
      <h4 className={styles.sectionTitle}>Lifetime Stats</h4>
      <StatRow label="Total trips" value={stats.trips.toLocaleString()} />
      <StatRow
        label="True overturns"
        value={stats.trueOvts}
        sub={`${stats.rebalanceOvts} during rebalance (excluded)`}
      />
      <StatRow label="Total repairs" value={stats.repairs} />
      {stats.avgRepairDays !== null && (
        <StatRow label="Avg. repair time" value={`${stats.avgRepairDays}d`} />
      )}
      <StatRow
        label="Total downtime"
        value={`${stats.dt.totalHours.toFixed(1)} h`}
        sub={Object.entries(stats.dt.byCause)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => `${k.replace('_', ' ')} ${Math.round(v)}h`)
          .join(' · ')}
      />
    </div>
  );
}
