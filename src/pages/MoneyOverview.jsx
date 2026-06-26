import { useMemo } from 'react';
import { TrendingUp, Receipt, Bike } from 'lucide-react';
import Header from '../components/Layout/Header.jsx';
import KpiCard from '../components/Dashboard/KpiCard.jsx';
import VerdictCard from '../components/Money/VerdictCard.jsx';
import UpcomingPanel from '../components/Money/UpcomingPanel.jsx';
import CommitmentsPanel from '../components/Money/CommitmentsPanel.jsx';
import PaidPanel from '../components/Money/PaidPanel.jsx';
import HealthChips from '../components/Money/HealthChips.jsx';
import ShowTheMath from '../components/Money/ShowTheMath.jsx';
import { useMetrics } from '../context/MetricsContext.jsx';
import { useCosts } from '../context/CostContext.jsx';
import { calcEBITDA, calcDSCR, calcCostRecoveryRate } from '../utils/financialHealth.js';
import { isCommitment } from '../utils/upcomingPayments.js';
import { formatEUR } from '../utils/formatters.js';
import styles from './MoneyOverview.module.css';

/**
 * Money overview (ADR-0025) — the founder-first cockpit that makes the numbers hub
 * VISIBLE as the single source of truth. Every figure here comes from useMetrics();
 * nothing is computed inline beyond presentational derivations (ADR-0024 preserved).
 */
export default function MoneyOverview() {
  const { mtd, upcoming30, scopedCosts, scopedRevenue } = useMetrics();
  const { config } = useCosts();

  const summary = mtd;
  const fin = config?.financial;

  const commitmentCount = useMemo(
    () => (scopedCosts || []).filter((c) => isCommitment(c)).length,
    [scopedCosts],
  );

  // Per-scooter margin = revenue/scooter − cost/scooter (MTD = one month).
  const fleet = summary.fleetSizeEffective || 0;
  const revPerScooter = fleet ? summary.revenue.operatingRevenue / fleet : 0;
  const costPerScooter = summary.perScooterMonthly;
  const margin = revPerScooter - costPerScooter;

  // Health metrics — reuse the existing engine (trailing-12-month basis).
  const health = useMemo(() => {
    const costs = scopedCosts || [];
    const rev = scopedRevenue || [];
    return {
      ebitdaMargin: calcEBITDA(costs, rev, fin).ebitdaMargin,
      dscr: calcDSCR(costs, rev, config || {}, fin),
      costRecovery: calcCostRecoveryRate(costs, rev, fin),
    };
  }, [scopedCosts, scopedRevenue, config, fin]);

  return (
    <div className={styles.page}>
      <Header title="Money" subtitle="Your finances at a glance" />

      <div className={styles.content}>
        <VerdictCard pnl={summary.displayPnL} periodLabel="this month" />

        <div className={styles.stats}>
          <KpiCard
            icon={TrendingUp}
            label="Money in"
            value={formatEUR(summary.revenue.operatingRevenue)}
            sub="this month, after Hopp fee + SIM"
          />
          <KpiCard
            icon={Receipt}
            label="Money out"
            value={formatEUR(summary.displayTotal)}
            sub={`this month · ${commitmentCount} commitments`}
          />
          <KpiCard
            icon={Bike}
            label="Per-scooter margin"
            value={`${formatEUR(margin)} /mo`}
            sub={`${formatEUR(revPerScooter)} rev − ${formatEUR(costPerScooter)} cost`}
          />
        </div>

        <div className={styles.grid2}>
          <UpcomingPanel upcoming={upcoming30} />
          <CommitmentsPanel
            monthly={summary.monthlyCostRate}
            annual={summary.annualTotal}
            byCategory={summary.costByCategory}
            count={commitmentCount}
          />
        </div>

        <PaidPanel total={summary.costsMTD} byCategory={summary.costByCategory} label="this month" />

        <HealthChips
          ebitdaMargin={health.ebitdaMargin}
          dscr={health.dscr}
          costRecovery={health.costRecovery}
        />

        <ShowTheMath summary={summary} upcoming={upcoming30} />
      </div>
    </div>
  );
}
