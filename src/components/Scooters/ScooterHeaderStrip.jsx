/**
 * ScooterHeaderStrip — Hopp-style KPI header for /scooters/:id
 * Shows: Total Distance, Total Trips, Revenue (attributed), Position Update, Connection Update
 */

import { useMemo } from 'react';
import { MapPin, Navigation, Wifi, TrendingUp, Route } from 'lucide-react';
import { useTelemetry } from '../../context/TelemetryContext.jsx';
import { useTrips } from '../../context/TripContext.jsx';
import { useRevenue } from '../../context/RevenueContext.jsx';
import { useMaintenance } from '../../context/MaintenanceContext.jsx';
import { useCosts } from '../../context/CostContext.jsx';
import { revenuePerScooterLifetime } from '../../utils/investmentCalculations.js';
import { formatKm, formatEUR, formatRelativeTime } from '../../utils/formatters.js';
import styles from './ScooterHeaderStrip.module.css';

function KpiCard({ icon: Icon, label, value, sub, accent }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardIcon} style={accent ? { color: accent } : {}}>
        <Icon size={18} />
      </div>
      <div className={styles.cardBody}>
        <span className={styles.cardLabel}>{label}</span>
        <span className={styles.cardValue}>{value}</span>
        {sub && <span className={styles.cardSub}>{sub}</span>}
      </div>
    </div>
  );
}

export default function ScooterHeaderStrip({ scooter }) {
  const { events }    = useTelemetry();
  const { trips }     = useTrips();
  const { revenueData } = useRevenue();
  const { tickets, scooters } = useMaintenance();
  const { config: costConfig } = useCosts();

  const scooterId    = scooter?.scooterId;
  const financial    = costConfig?.financial ?? null;
  // #558: divide by the live org-wide scooter count (revenueData here is org-wide, so
  // the divisor must match that scope); fall back to the config scalar when unloaded.
  const defaultFleet = scooters?.length || costConfig?.fleetSize || 1;

  // Trip-based KPIs (from scooterTrips collection)
  const tripStats = useMemo(() => {
    const myTrips = trips.filter((t) => String(t.scooterId) === String(scooterId));
    return {
      count:    myTrips.length,
      distKm:   myTrips.reduce((s, t) => s + (t.distanceKm || 0), 0),
      revenue:  myTrips.reduce((s, t) => s + (t.cost || 0), 0),
      hasData:  myTrips.length > 0,
    };
  }, [trips, scooterId]);

  // Attributed revenue (from revenueData, same as Investment Ledger)
  const myTickets = useMemo(() =>
    tickets.filter((t) => String(t.scooterId) === String(scooterId)),
  [tickets, scooterId]);

  const { total: attributedRevenue } = useMemo(() =>
    revenuePerScooterLifetime(scooter, revenueData, myTickets, financial, defaultFleet),
  [scooter, revenueData, myTickets, financial, defaultFleet]);

  // Telemetry timestamps
  const scooterEvents = useMemo(() =>
    events.filter((e) => e.scooterId === scooterId),
  [events, scooterId]);

  const latestPosition = useMemo(() => {
    const pos = scooterEvents
      .filter((e) => e.eventType?.includes('trip') || e.eventType?.includes('rebalance'))
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))[0];
    return pos?.timestamp || null;
  }, [scooterEvents]);

  const latestConnection = useMemo(() => {
    const conn = scooterEvents
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))[0];
    return conn?.timestamp || null;
  }, [scooterEvents]);

  return (
    <div className={styles.strip}>
      <KpiCard
        icon={Route}
        label="Total Distance"
        value={tripStats.hasData ? formatKm(tripStats.distKm) : '—'}
        sub={tripStats.hasData ? `${tripStats.count} trips` : 'Import trip CSV'}
        accent="var(--color-primary)"
      />
      <KpiCard
        icon={Navigation}
        label="Total Trips"
        value={tripStats.hasData ? String(tripStats.count) : '—'}
        sub={tripStats.hasData ? null : 'Import trip CSV'}
      />
      <KpiCard
        icon={TrendingUp}
        label="Revenue (ex-VAT)"
        value={formatEUR(tripStats.hasData ? tripStats.revenue : attributedRevenue)}
        sub={tripStats.hasData ? 'From trip data' : 'Fleet share estimate'}
        accent="var(--color-success)"
      />
      <KpiCard
        icon={MapPin}
        label="Position Update"
        value={latestPosition ? formatRelativeTime(latestPosition) : '—'}
        sub="Last known movement"
      />
      <KpiCard
        icon={Wifi}
        label="Connection Update"
        value={latestConnection ? formatRelativeTime(latestConnection) : '—'}
        sub="Last telemetry ping"
      />
    </div>
  );
}
