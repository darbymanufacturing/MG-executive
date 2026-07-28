import { useMemo } from 'react';
import { Scale, Building2 } from 'lucide-react';
import Header from '../components/Layout/Header.jsx';
import EmptyState from '../components/Shared/EmptyState.jsx';
import { useFleet } from '../context/FleetContext.jsx';
import { useRevenue } from '../context/RevenueContext.jsx';
import { useCosts } from '../context/CostContext.jsx';
import { useMaintenance } from '../context/MaintenanceContext.jsx';
import { formatEUR } from '../utils/formatters.js';
import styles from './FleetPnl.module.css';

/**
 * FF-3 — Per-fleet P&L scoreboard (the payoff). Each fleet: revenue − costs −
 * maintenance = profit, side by side, + a company total. "Is Corinth profitable, or
 * is Nafplio carrying it?" Revenue/maintenance attribute by city (transition model);
 * costs attribute only when tagged to a fleet (per-cost scope toggle) — untagged costs
 * are company-wide overhead shown on their own line so the company total still balances.
 *
 * W5/ADR-0024 — this page DELIBERATELY does NOT route through the numbers hub
 * (useMetrics/financialSummary). It is the one sanctioned exception: it sums RAW
 * per-fleet `c.amount` on an all-time basis (not the hub's monthly run-rate
 * normalization) and attributes by `c.fleetId`, because the FF-3 scoreboard answers
 * "all-time euros in vs out, per fleet" — a different question than the hub's
 * period/run-rate model. Do not "fix" this into useMetrics: that would silently change
 * every figure on this page. See ADR-0024.
 */
export default function FleetPnl() {
  const { fleets } = useFleet();
  const { revenueData } = useRevenue();
  const { costs } = useCosts();
  const { tickets } = useMaintenance();

  const cityKey = (c) => String(c ?? '').toLowerCase();

  const companyWideCosts = useMemo(
    () => (costs ?? []).filter((c) => !c.fleetId).reduce((s, c) => s + (Number(c.amount) || 0), 0),
    [costs],
  );

  // Company-wide (untagged) costs are split EVENLY across the fleets — each fleet
  // carries companyWide / fleetCount as its "shared overhead" line (owner decision
  // 2026-07-27; previously overhead sat outside every fleet's P&L).
  const overheadShare = fleets.length > 0 ? companyWideCosts / fleets.length : 0;

  const rows = useMemo(() => {
    return fleets.map((f) => {
      const cities = new Set((f.cities ?? []).map(cityKey));
      const inFleet = (c) => c != null && cities.has(cityKey(c));
      const revenue = (revenueData ?? [])
        .filter((r) => inFleet(r.location ?? r.city))
        .reduce((s, r) => s + (Number(r.totalPaidRevenue) || 0), 0);
      const maintenance = (tickets ?? [])
        .filter((t) => inFleet(t.city))
        .reduce((s, t) => s + (Number(t.totalCost) || 0), 0);
      const directCosts = (costs ?? [])
        .filter((c) => c.fleetId === f._docId)
        .reduce((s, c) => s + (Number(c.amount) || 0), 0);
      const profit = revenue - directCosts - overheadShare - maintenance;
      const margin = revenue > 0 ? (profit / revenue) * 100 : null;
      return { fleet: f, revenue, maintenance, costs: directCosts, overheadShare, profit, margin };
    });
  }, [fleets, revenueData, costs, tickets, overheadShare]);

  // #596 — the company strip is the WHOLE company, all-time; it must not depend on
  // fleet attribution. Costs already included the untagged overhead bucket while
  // revenue/maintenance counted only city-attributed rows, so fleets with no cities
  // made the headline read "Revenue €0" while /revenue showed €65k. Sum the raw
  // collections here; the per-fleet cards below stay attribution-based.
  const totals = useMemo(() => {
    const rev = (revenueData ?? []).reduce((s, r) => s + (Number(r.totalPaidRevenue) || 0), 0);
    const maint = (tickets ?? []).reduce((s, t) => s + (Number(t.totalCost) || 0), 0);
    const allCosts = (costs ?? []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const profit = rev - allCosts - maint;
    return { rev, maint, allCosts, profit, margin: rev > 0 ? (profit / rev) * 100 : null };
  }, [revenueData, tickets, costs]);

  // Revenue no fleet claims (its city is on no fleet) — counted in the company total,
  // in no fleet card. Surface it so the gap is never silent.
  const unattributedRevenue = useMemo(
    () => totals.rev - rows.reduce((s, r) => s + r.revenue, 0),
    [totals, rows],
  );

  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.profit)));

  return (
    <div className={styles.page}>
      <Header
        title="Fleet P&L"
        subtitle="All-time revenue − costs − maintenance, per fleet"
      />

      {fleets.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="No fleets to compare yet"
          description="Create your fleets from the fleet switcher (top bar → Manage fleets), then come back to see each one’s profitability side by side."
        />
      ) : (
        <div className={styles.content}>
          {/* Company total strip */}
          <div className={styles.totalStrip}>
            <div className={styles.totalCell}>
              <span className={styles.totalLabel}>Revenue</span>
              <span className={styles.totalVal}>{formatEUR(totals.rev)}</span>
            </div>
            <span className={styles.op}>−</span>
            <div className={styles.totalCell}>
              <span className={styles.totalLabel}>Costs</span>
              <span className={styles.totalVal}>{formatEUR(totals.allCosts)}</span>
            </div>
            <span className={styles.op}>−</span>
            <div className={styles.totalCell}>
              <span className={styles.totalLabel}>Maintenance</span>
              <span className={styles.totalVal}>{formatEUR(totals.maint)}</span>
            </div>
            <span className={styles.op}>=</span>
            <div className={styles.totalCell}>
              <span className={styles.totalLabel}>Company profit</span>
              <span className={`${styles.totalVal} ${styles.big}`} style={{ color: totals.profit >= 0 ? 'var(--status-green)' : 'var(--status-red)' }}>
                {totals.profit >= 0 ? '+' : '−'}{formatEUR(Math.abs(totals.profit))}
              </span>
              {totals.margin != null && <span className={styles.totalSub}>{totals.margin.toFixed(1)}% margin</span>}
            </div>
          </div>

          {/* Per-fleet scoreboard */}
          <div className={styles.grid}>
            {rows.map(({ fleet, revenue, maintenance, costs: fc, overheadShare: share, profit, margin }) => {
              const pos = profit >= 0;
              const barPct = Math.round((Math.abs(profit) / maxAbs) * 100);
              return (
                <div key={fleet._docId} className={styles.card}>
                  <div className={styles.cardHead}>
                    <span className={styles.fleetName}>{fleet.name}</span>
                    {fleet.cities?.length ? <span className={styles.fleetCities}>{fleet.cities.join(', ')}</span> : null}
                  </div>

                  <div className={styles.profitRow}>
                    <span className={styles.profitVal} style={{ color: pos ? 'var(--status-green)' : 'var(--status-red)' }}>
                      {pos ? '+' : '−'}{formatEUR(Math.abs(profit))}
                    </span>
                    {margin != null && (
                      <span className={`${styles.marginBadge} ${pos ? styles.marginPos : styles.marginNeg}`}>
                        {margin.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <div className={styles.bar}>
                    <div
                      className={styles.barFill}
                      style={{ width: `${barPct}%`, background: pos ? 'var(--status-green)' : 'var(--status-red)' }}
                    />
                  </div>

                  <div className={styles.lines}>
                    <div className={styles.line}><span>Revenue</span><span className={styles.lineVal}>{formatEUR(revenue)}</span></div>
                    <div className={styles.line}><span>Costs (direct)</span><span className={styles.lineNeg}>−{formatEUR(fc)}</span></div>
                    <div className={styles.line}><span>Shared overhead</span><span className={styles.lineNeg}>−{formatEUR(share)}</span></div>
                    <div className={styles.line}><span>Maintenance</span><span className={styles.lineNeg}>−{formatEUR(maintenance)}</span></div>
                  </div>

                  {/* Revenue + maintenance attribute BY CITY — a fleet with no cities
                      silently shows €0 for both (owner-reported 2026-07-27). Surface it. */}
                  {!(fleet.cities?.length) && (
                    <div className={styles.noCitiesWarn}>
                      ⚠ No cities configured — revenue &amp; maintenance can&rsquo;t be attributed to
                      this fleet. Add its cities via the fleet switcher → Manage fleets.
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Company-wide overhead note — split evenly across fleets */}
          <div className={styles.overhead}>
            <Building2 size={15} />
            <span>
              <strong>{formatEUR(companyWideCosts)}</strong> in company-wide costs are split evenly across
              the {fleets.length} fleet{fleets.length === 1 ? '' : 's'} as &ldquo;shared overhead&rdquo;
              ({formatEUR(overheadShare)} each). Tag a cost to a fleet from the cost form
              (&ldquo;Applies to&rdquo;) to assign it directly instead.
            </span>
          </div>

          {unattributedRevenue > 0.005 && (
            <div className={styles.overhead}>
              <Building2 size={15} />
              <span>
                <strong>{formatEUR(unattributedRevenue)}</strong> of revenue isn&rsquo;t attributed to any
                fleet — its city isn&rsquo;t listed on one. It counts in the company total above but in no
                fleet card. Add the city via the fleet switcher &rarr; Manage fleets.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
