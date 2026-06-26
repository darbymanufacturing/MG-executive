import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useTelemetry } from '../../../context/TelemetryContext.jsx';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import { isTrueOverturn } from '../../../utils/classifyEventType.js';
import { validTickets } from '../../../utils/repairJunkFilter.js';
import { countRealTrips } from '../../../utils/pmeAnalyses.js';
import EmptyState from '../../Shared/EmptyState.jsx';
import styles from './Reports.module.css';

function bucketByMonth(events, tickets) {
  const months = {};
  // Accumulate per-month event arrays so countRealTrips() can pair
  // trip_start → trip_end per scooter (eliminates pause/resume double-starts
  // and sub-30s cancelled-reservation artefacts).
  const monthEvents = {};

  for (const ev of events) {
    const m = ev.timestamp?.slice(0, 7);
    if (!m) continue;
    if (!months[m])      months[m]      = { month: m, trips: 0, overturns: 0, repairs: 0 };
    if (!monthEvents[m]) monthEvents[m] = [];
    monthEvents[m].push(ev);
    if (isTrueOverturn(ev)) months[m].overturns++;
  }

  // Use countRealTrips (same function as FleetKpiStrip / WeeklyDigest / ScooterLifetimeStats)
  // so the bar chart aligns with every other trip surface.
  for (const m of Object.keys(months)) {
    months[m].trips = countRealTrips(monthEvents[m]);
  }

  for (const t of validTickets(tickets)) {
    const m = t.dateEntered?.slice(0, 7);
    if (!m) continue;
    if (!months[m]) months[m] = { month: m, trips: 0, overturns: 0, repairs: 0 };
    months[m].repairs++;
  }

  return Object.values(months).sort((a, b) => a.month.localeCompare(b.month));
}

const TOOLTIP_STYLE = {
  contentStyle: { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 6, fontSize: 12 },
  labelStyle: { color: '#888' },
};

export default function MonthlyOverview() {
  const { events } = useTelemetry();
  const { tickets } = useMaintenance();

  const data = useMemo(() => bucketByMonth(events, tickets), [events, tickets]);

  if (!data.length) {
    return (
      <EmptyState
        title="No data available"
        description="Upload a Status Log CSV on the Ingest tab."
      />
    );
  }

  return (
    <div className={styles.monthly}>
      <h3 className={styles.monthlyTitle}>Month-over-Month</h3>

      <div className={styles.chartWrap}>
        <p className={styles.chartLabel}>Trips per month</p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#888' }} />
            <YAxis tick={{ fontSize: 10, fill: '#888' }} />
            <Tooltip {...TOOLTIP_STYLE} />
            <Bar isAnimationActive={false} dataKey="trips" fill="#00C896" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className={styles.chartWrap}>
        <p className={styles.chartLabel}>Overturns & Repairs per month</p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#888' }} />
            <YAxis tick={{ fontSize: 10, fill: '#888' }} />
            <Tooltip {...TOOLTIP_STYLE} />
            <Bar isAnimationActive={false} dataKey="overturns" fill="#E84545" radius={[3, 3, 0, 0]} name="Overturns" />
            <Bar isAnimationActive={false} dataKey="repairs"   fill="#F5A623" radius={[3, 3, 0, 0]} name="Repairs" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
