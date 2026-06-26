import { createContext, useContext, useMemo } from 'react';
import { useCosts } from './CostContext.jsx';
import { useRevenue } from './RevenueContext.jsx';
import { useMaintenance } from './MaintenanceContext.jsx';
import { useFleet } from './FleetContext.jsx';
import { financialSummary } from '../utils/financialSummary.js';
import { filterCostsByLocation } from '../utils/calculations.js';
import { filterRevenueByLocation } from '../utils/revenueCalculations.js';
import { upcomingForCosts } from '../utils/upcomingPayments.js';

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

  // A clock that ticks at most once per calendar day (keyed on the local date), so period
  // boundaries + the forward-looking window advance across midnight / month-end without
  // churning memos on every render. Threaded into financialSummary (options.now) AND
  // upcomingForCosts so the whole hub shares one stable "today" (ADR-0024/0025).
  const t = new Date();
  const todayKey = `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`;
  const now = useMemo(() => {
    const [y, m, d] = todayKey.split('-').map(Number);
    return new Date(y, m, d);
  }, [todayKey]);
  const mtdPeriod = useMemo(() => ({
    mode: 'month',
    monthKey: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    months: 1,
  }), [now]);

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
      { ...(opts.options ?? {}), now },
    );
  }, [scopedCosts, scopedRevenue, scopedScooters, config, now]);

  // ── getUpcoming ───────────────────────────────────────────────────────────────
  // Forward-looking payment calendar (ADR-0025). Mirrors getSummary's location-scoping
  // so the Money overview + Expenses page read ONE canonical "what's coming" — the
  // derivation lives in upcomingForCosts (pure), the scoping lives here (the hub).
  const getUpcoming = useMemo(() => (days = 30, opts = {}) => {
    const location = opts.location ?? null;
    const costsForCalc = filterCostsByLocation(scopedCosts, location);
    return upcomingForCosts(costsForCalc, { horizonDays: days, now });
  }, [scopedCosts, now]);

  // Pre-baked views the lighter consumers (PulseStrip) read directly.
  const mtd = useMemo(() => getSummary(mtdPeriod), [getSummary, mtdPeriod]);
  const allTime = useMemo(() => getSummary(ALL_PERIOD), [getSummary]);
  const upcoming30 = useMemo(() => getUpcoming(30), [getUpcoming]);

  const value = useMemo(() => ({
    getSummary,
    getUpcoming,
    mtd,
    allTime,
    upcoming30,
    fleetScope,
    isAllFleets,
    activeFleet,
    // Exposed so Dashboard (and other chart consumers) can build location-filtered
    // arrays from already-fleet-scoped data, matching the hub's own scope (#638).
    scopedCosts,
    scopedRevenue,
  }), [getSummary, getUpcoming, mtd, allTime, upcoming30, fleetScope, isAllFleets, activeFleet, scopedCosts, scopedRevenue]);

  return <MetricsContext.Provider value={value}>{children}</MetricsContext.Provider>;
}

export function useMetrics() {
  const ctx = useContext(MetricsContext);
  if (!ctx) throw new Error('useMetrics must be used inside <MetricsProvider>');
  return ctx;
}
