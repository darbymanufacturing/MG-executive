import { useMemo } from 'react';
import { Scale, Building2 } from 'lucide-react';
import Header from '../components/Layout/Header.jsx';
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
 */
export default function FleetPnl() {
  const { fleets } = useFleet();
  const { revenueData } = useRevenue();
  const { costs } = useCosts();
  const { tickets } = useMaintenance();

  const cityKey = (c) => String(c ?? '').toLowerCase();

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
      const fleetCosts = (costs ?? [])
        .filter((c) => c.fleetId === f._docId)
        .reduce((s, c) => s + (Number(c.amount) || 0), 0);
      const profit = revenue - fleetCosts - maintenance;
      const margin = revenue > 0 ? (profit / revenue) * 100 : null;
      return { fleet: f, revenue, maintenance, costs: fleetCosts, profit, margin };
    });
  }, [fleets, revenueData, costs, tickets]);

  const companyWideCosts = useMemo(
    () => (costs ?? []).filter((c) => !c.fleetId).reduce((s, c) => s + (Number(c.amount) || 0), 0),
    [costs],
  );

  const totals = useMemo(() => {
    const rev = rows.reduce((s, r) => s + r.revenue, 0);
    const maint = rows.reduce((s, r) => s + r.maintenance, 0);
    const fleetCosts = rows.reduce((s, r) => s + r.costs, 0);
    const allCosts = fleetCosts + companyWideCosts;
    const profit = rev - allCosts - maint;
    return { rev, maint, allCosts, profit, margin: rev > 0 ? (profit / rev) * 100 : null };
  }, [rows, companyWideCosts]);

  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.profit)));

  return (
    <div className={styles.page}>
      <Header
        title="Fleet P&L"
        subtitle="All-time revenue − costs − maintenance, per fleet"
      />

      {fleets.length === 0 ? (
        <div className={styles.empty}>
          <Scale size={40} className={styles.emptyIcon} />
          <p className={styles.emptyTitle}>No fleets to compare yet</p>
          <p className={styles.emptyDesc}>
            Create your fleets from the fleet switcher (top bar → Manage fleets), then come back to
            see each one&rsquo;s profitability side by side.
          </p>
        </div>
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
            {rows.map(({ fleet, revenue, maintenance, costs: fc, profit, margin }) => {
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
                    <div className={styles.line}><span>Costs</span><span className={styles.lineNeg}>−{formatEUR(fc)}</span></div>
                    <div className={styles.line}><span>Maintenance</span><span className={styles.lineNeg}>−{formatEUR(maintenance)}</span></div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Company-wide overhead note */}
          <div className={styles.overhead}>
            <Building2 size={15} />
            <span>
              <strong>{formatEUR(companyWideCosts)}</strong> in company-wide costs aren&rsquo;t assigned to a fleet.
              Tag a cost to a fleet from the cost form (&ldquo;Applies to&rdquo;) to fold it into that fleet&rsquo;s P&L.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
