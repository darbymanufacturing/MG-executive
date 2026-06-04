import { useMemo } from 'react';
import { useTelemetry } from '../../../context/TelemetryContext.jsx';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import { fleetKpis } from '../../../utils/pmeAnalyses.js';
import styles from './Fleet.module.css';

function KpiCard({ label, value, sub, color }) {
  return (
    <div className={styles.kpiCard}>
      <span className={styles.kpiValue} style={color ? { color } : {}}>
        {value}
      </span>
      <span className={styles.kpiLabel}>{label}</span>
      {sub && <span className={styles.kpiSub}>{sub}</span>}
    </div>
  );
}

export default function FleetKpiStrip() {
  const { events } = useTelemetry();
  const { scooters, tickets } = useMaintenance();

  const kpis = useMemo(
    () => fleetKpis(events, tickets, scooters),
    [events, tickets, scooters],
  );

  const dtHrs = kpis.totalDowntimeHrs;

  return (
    <div className={styles.kpiStrip}>
      <KpiCard
        label="Fleet Size"
        value={kpis.totalScooters}
        sub={`${kpis.activeScooters} active`}
      />
      <KpiCard
        label="Fleet Active %"
        value={`${kpis.utilisationPct}%`}
        sub="Active scooters ÷ total fleet"
        color={kpis.utilisationPct >= 70 ? '#00C896' : kpis.utilisationPct >= 50 ? '#F5A623' : '#E84545'}
      />
      <KpiCard
        label="Total Trips"
        value={kpis.totalTrips.toLocaleString()}
        sub="from status log"
      />
      <KpiCard
        label="True Overturns"
        value={kpis.trueOverturns.toLocaleString()}
        sub={`${kpis.overturnRate}% of trips`}
        color={kpis.overturnRate > 5 ? '#E84545' : kpis.overturnRate > 2 ? '#F5A623' : undefined}
      />
      <KpiCard
        label="Downtime"
        value={`${dtHrs.toLocaleString()} h`}
        sub={Object.entries(kpis.downtimeByCause)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => `${k.replace('_', ' ')}: ${Math.round(v)}h`)
          .join(' · ')}
      />
      <KpiCard
        label="Repairs"
        value={kpis.totalRepairs.toLocaleString()}
        sub="excl. junk entries"
      />
    </div>
  );
}
