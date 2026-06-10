import { createContext, useContext, useMemo } from 'react';
import { useCosts } from './CostContext.jsx';
import { useRevenue } from './RevenueContext.jsx';
import { useMaintenance } from './MaintenanceContext.jsx';
import { useFleet } from './FleetContext.jsx';
import { financialSummary } from '../utils/financialSummary.js';
import { filterCostsByLocation } from '../utils/calculations.js';
import { filterRevenueByLocation } from '../utils/revenueCalculations.js';

/**
 * MetricsContext — the numbers hub (W5, ADR-0024).
 *
 * The ONE place financial-scope wiring happens:
 *   1. Consumes useCosts() + useRevenue() + useMaintenance() (scooters live here, not a
 *      dedicated ScooterContext) + useFleet().
 *   2. Applies `scopeByFleet` ONCE (memoized) to costs / revenue / scooters. After this,
 *      NO page applies scopeByFleet for financial math anymore — they read the hub.
 *      scopeByFleet semantics are preserved verbatim (#562: unassigned docs are included
 *      in every fleet view; FleetContext.jsx:66-80).
 *   3. Hands out `getSummary(period, { location })` → a memoized `financialSummary(...)`
 *      over the scoped + location-filtered arrays, plus pre-baked `mtd` and `allTime` views.
 *
 * Pages READ summaries; they never recompute totals (see financialSummary.js header).
 */
const MetricsContext = createContext(null);

const MTD_PERIOD = (() => {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return { mode: 'month', monthKey, months: 1 };
})();

const ALL_PERIOD = { mode: 'all', months: 1 };

export function MetricsProvider({ children }) {
  const { costs, config } = useCosts();
  const { revenueData } = useRevenue();
  const { scooters } = useMaintenance();
  const { scopeByFleet, isAllFleets, activeFleet } = useFleet();

  // ── Apply fleet scope ONCE (#562 semantics preserved) ─────────────────────
  const scopedCosts = useMemo(() => scopeByFleet(costs || []), [scopeByFleet, costs]);
  const scopedRevenue = useMemo(() => scopeByFleet(revenueData || []), [scopeByFleet, revenueData]);
  const scopedScooters = useMemo(() => scopeByFleet(scooters || []), [scopeByFleet, scooters]);

  // A stable description of the current fleet scope (for the Inspector / provenance).
  const fleetScope = useMemo(() => (
    isAllFleets
      ? { mode: 'all-fleets', label: 'All Fleets', fleetId: null }
      : { mode: 'fleet', label: activeFleet?.name ?? 'Unknown fleet', fleetId: activeFleet?._docId ?? null }
  ), [isAllFleets, activeFleet]);

  // ── getSummary ──────────────────────────────────────────────────────────────
  // Pure: filter by location, then defer to financialSummary. Its identity is stable
  // across renders with the same scoped inputs/config, so consumers can list it in their
  // own useMemo deps without churn. (financialSummary itself is cheap + side-effect-free;
  // hot consumers like Dashboard wrap the call in their own useMemo for the period.)
  const getSummary = useMemo(() => (period, opts = {}) => {
    const location = opts.location ?? null;
    const costsForCalc = filterCostsByLocation(scopedCosts, location);
    const revenueForCalc = filterRevenueByLocation(scopedRevenue, location);
    return financialSummary(
      costsForCalc,
      revenueForCalc,
      scopedScooters,
      config,
      period,
      opts.options ?? {},
    );
  }, [scopedCosts, scopedRevenue, scopedScooters, config]);

  // Pre-baked views the lighter consumers (PulseStrip) read directly.
  const mtd = useMemo(() => getSummary(MTD_PERIOD), [getSummary]);
  const allTime = useMemo(() => getSummary(ALL_PERIOD), [getSummary]);

  const value = useMemo(() => ({
    getSummary,
    mtd,
    allTime,
    fleetScope,
    isAllFleets,
    activeFleet,
  }), [getSummary, mtd, allTime, fleetScope, isAllFleets, activeFleet]);

  return <MetricsContext.Provider value={value}>{children}</MetricsContext.Provider>;
}

export function useMetrics() {
  const ctx = useContext(MetricsContext);
  if (!ctx) throw new Error('useMetrics must be used inside <MetricsProvider>');
  return ctx;
}
