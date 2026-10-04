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
import { calcEBITDA, calcDSCR, calcCostRecoveryRate, monthlyDebtServiceFromCosts } from '../utils/financialHealth.js';
import { formatEUR } from '../utils/formatters.js';
import styles from './MoneyOverview.module.css';

/**
 * Money overview (ADR-0025) — the founder-first cockpit that makes the numbers hub
 * VISIBLE as the single source of truth. Every figure here comes from useMetrics();
 * nothing is computed inline beyond presentational derivations (ADR-0024 preserved).
 */
export default function MoneyOverview() {
  const { mtd, allTime, upcoming30, handledThisMonth, scopedCostsNow, scopedRevenue } = useMetrics();
  const { config, setCostSettlement } = useCosts();

  const summary = mtd;
  const fin = config?.financial;

  // "What we have" is today's standing commitments — the hub's 'all' view, the same
  // numbers the Expenses page shows — not this month's costs (#711).
  const commitmentCount = allTime.commitmentCount;

  // Per-scooter margin = revenue/scooter − cost/scooter (MTD = one month).
  const fleet = summary.fleetSizeEffective || 0;
  const revPerScooter = fleet ? summary.revenue.operatingRevenue / fleet : 0;
  const costPerScooter = summary.perScooterMonthly;
  const margin = revPerScooter - costPerScooter;

  // Health metrics — reuse the existing engine (trailing-12-month basis).
  const health = useMemo(() => {
    const costs = scopedCostsNow || []; // today's run-rate — ended commitments are not in it (#711)
    const rev = scopedRevenue || [];
    return {
      ebitdaMargin: calcEBITDA(costs, rev, fin).ebitdaMargin,
      // #699 — derive debt service from the loan/card cost rows; there is no
      // `monthlyDebtService` Settings field, so the raw config always yielded null
      // and this chip read "—" forever.
      dscr: calcDSCR(
        costs,
        rev,
        { ...(config || {}), monthlyDebtService: monthlyDebtServiceFromCosts(costs) || null },
        fin,
      ),
      costRecovery: calcCostRecoveryRate(costs, rev, fin),
    };
  }, [scopedCostsNow, scopedRevenue, config, fin]);

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
          <UpcomingPanel upcoming={upcoming30} handled={handledThisMonth} onMark={setCostSettlement} />
          <CommitmentsPanel
            monthly={allTime.monthlyCostRate}
            annual={allTime.annualTotal}
            byCategory={allTime.costByCategory}
            count={commitmentCount}
          />
        </div>

        <PaidPanel
          total={summary.paidThisMonth}
          byCategory={summary.paidThisMonthByCategory}
          due={summary.dueThisMonth}
          label="this month"
        />

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
