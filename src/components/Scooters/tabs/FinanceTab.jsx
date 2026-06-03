/**
 * FinanceTab — wraps ScooterLedgerDetail for the unified scooter page.
 *
 * Revenue source priority:
 *   1. scooterTrips collection (exact per-trip data, when imported)
 *   2. Fleet-attribution formula (revenueData ÷ activeFleet, when no trips)
 */

import { useMemo } from 'react';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import { useRevenue } from '../../../context/RevenueContext.jsx';
import { useCosts } from '../../../context/CostContext.jsx';
import { useTrips } from '../../../context/TripContext.jsx';
import { scooterLedgerRow } from '../../../utils/investmentCalculations.js';
import ScooterLedgerDetail from '../../Investment/ScooterLedgerDetail.jsx';
import styles from './Tab.module.css';

/** Group trip rows into { total, monthly } shape expected by scooterLedgerRow */
function buildTripRevenue(trips, scooterId) {
  const myTrips = trips.filter((t) => String(t.scooterId) === String(scooterId));
  if (myTrips.length === 0) return null;

  const monthlyMap = {};
  myTrips.forEach((t) => {
    if (!t.startedAt) return;
    const key = t.startedAt.slice(0, 7); // YYYY-MM
    monthlyMap[key] = (monthlyMap[key] || 0) + (t.cost || 0);
  });

  const monthly = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, revenue]) => ({ key, revenue: parseFloat(revenue.toFixed(2)) }));

  const total = parseFloat(monthly.reduce((s, m) => s + m.revenue, 0).toFixed(2));
  return { total, monthly };
}

export default function FinanceTab({ scooter }) {
  const { tickets, parts, config: maintConfig, scooters } = useMaintenance();
  const { revenueData } = useRevenue();
  const { config: costConfig } = useCosts();
  const { trips } = useTrips();

  const financial    = costConfig?.financial ?? null;
  const labourRate   = maintConfig?.labourRatePerHour ?? 0;
  // #558: prefer the live org-wide scooter count over the stale config scalar
  // (attribution uses org-wide revenueData, so the divisor stays org-wide).
  const defaultFleet = scooters?.length || costConfig?.fleetSize || 1;

  // Use trip-level revenue when trips exist for this scooter
  const tripRevenue = useMemo(
    () => buildTripRevenue(trips, scooter.scooterId),
    [trips, scooter.scooterId],
  );

  const row = useMemo(() =>
    scooterLedgerRow(
      scooter, revenueData, tickets, parts,
      financial, labourRate, defaultFleet,
      tripRevenue,           // null → falls back to attribution
    ),
  [scooter, revenueData, tickets, parts, financial, labourRate, defaultFleet, tripRevenue]);

  return (
    <div className={styles.tab}>
<ScooterLedgerDetail
        row={row}
        onClose={() => {}}
        hideClose
        revenueNote={tripRevenue
          ? `Revenue from imported trip data (ex-VAT, ${tripRevenue.monthly.length} month${tripRevenue.monthly.length !== 1 ? 's' : ''}).`
          : null}
      />
    </div>
  );
}
