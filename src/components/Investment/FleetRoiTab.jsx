import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import { TrendingUp, Target, Clock, BarChart2, Info } from 'lucide-react';
import { useCosts } from '../../context/CostContext.jsx';
import { useMetrics } from '../../context/MetricsContext.jsx';
import {
  annualInvestmentCost,
  getHealthColor,
} from '../../utils/financialHealth.js';
import {
  projectCumulativePnL,
  findBreakEvenMonth,
} from '../../utils/investmentCalculations.js';
import { formatEUR, formatEURCompact } from '../../utils/formatters.js';
import KpiCard from '../Dashboard/KpiCard.jsx';
import styles from './FleetRoiTab.module.css';

const HORIZON_OPTIONS = [24, 36, 48, 60, 84];

export default function FleetRoiTab() {
  const { costs } = useCosts();
  const { allTime } = useMetrics();

  // ── Derived actuals (base values before overrides) ──────────────────────
  // W5/ADR-0024 — pull the two base figures from the numbers hub for EXACT-BASIS parity:
  //  - annualizedRevenue: the SAME trailing-12-month basis financialHealth uses (NOT the
  //    period operatingRevenue — the bases differ and must never be swapped silently).
  //  - monthlyOpexExInvestment: the SAME totalMonthlyCost(non-investment) basis (#278
  //    null-category guard included in the selector). baseInvestment stays page-local.
  const baseMonthlyRevenue = allTime.annualizedRevenue / 12;
  const baseMonthlyOpex = allTime.monthlyOpexExInvestment;

  const baseInvestment = useMemo(() => annualInvestmentCost(costs), [costs]);

  // ── User inputs ──────────────────────────────────────────────────────────
  const [horizonMonths, setHorizonMonths] = useState(60);
  const [investmentOverride, setInvestmentOverride] = useState('');
  const [revenueOverride, setRevenueOverride]       = useState('');
  const [opexOverride, setOpexOverride]             = useState('');

  // #263 — guard against NaN from inputs that Number() coerces (e.g. "", "abc")
  const investment    = investmentOverride !== '' && Number.isFinite(Number(investmentOverride))
    ? Number(investmentOverride) : baseInvestment;
  const monthlyRevenue = revenueOverride !== '' && Number.isFinite(Number(revenueOverride))
    ? Number(revenueOverride) : baseMonthlyRevenue;
  const monthlyOpex    = opexOverride !== '' && Number.isFinite(Number(opexOverride))
    ? Number(opexOverride) : baseMonthlyOpex;

  // ── Projection ───────────────────────────────────────────────────────────
  const pnlSeries = useMemo(() =>
    projectCumulativePnL({ investment, horizonMonths, monthlyRevenue, monthlyOpex }),
  [investment, horizonMonths, monthlyRevenue, monthlyOpex]);

  const breakEvenMonth = useMemo(() => findBreakEvenMonth(pnlSeries), [pnlSeries]);

  // ── KPIs ─────────────────────────────────────────────────────────────────
  // #618 — use fleet-scoped hub values so KPIs and the projection chart share the same
  // basis.  Raw `costs`/`revenueData` from useCosts()/useRevenue() are unscoped and would
  // show all-fleet totals even when a specific fleet is selected.
  //
  // allTime.annualizedRevenue      — fleet-scoped trailing-12-month annualized revenue
  //   (identical basis to what calcROI/calcPaybackPeriod/calcEBITDA call internally via
  //   annualizedRevenue(revenueData, financial) — MetricsContext passes financial through).
  // allTime.monthlyCostRate * 12   — fleet-scoped annual recurring cost (≡ totalMonthlyCost(costs)*12).
  //   One-time items have monthlyMultiplier=0 so they do not inflate this figure.
  // allTime.monthlyOpexExInvestment * 12 — fleet-scoped annual opex excl. investment category
  //   (the correct denominator for EBITDA per calcEBITDA's filter).
  // baseInvestment (annualInvestmentCost from line above) — uses normalizeToAnnual on
  //   investment-category items; one-time investments have annualMultiplier=1 so their
  //   full purchase price is captured.  This still reads raw `costs` because annualTotal
  //   (monthly*12) excludes one-time items and there is no equivalent in the hub yet.
  //   The projection-chart inputs already use baseInvestment the same way, so the
  //   investment-cost basis is at least internally consistent within this component.
  const roi = useMemo(() => {
    if (!baseInvestment) return null;
    const annualRev = allTime.annualizedRevenue;
    if (!annualRev) return null;
    const netProfit = annualRev - allTime.annualTotal;
    return (netProfit / baseInvestment) * 100;
  }, [baseInvestment, allTime]);

  const payback = useMemo(() => {
    if (!baseInvestment) return null;
    const annualRev = allTime.annualizedRevenue;
    if (!annualRev) return null;
    const monthlyNet = annualRev / 12 - allTime.monthlyCostRate;
    if (monthlyNet <= 0) return Infinity;
    return baseInvestment / monthlyNet;
  }, [baseInvestment, allTime]);

  const ebitda = useMemo(() => {
    const annualRev = allTime.annualizedRevenue;
    if (!annualRev) return { ebitda: null, ebitdaMargin: null };
    const annualOpsCost = allTime.monthlyOpexExInvestment * 12;
    const ebitdaVal = annualRev - annualOpsCost;
    return { ebitda: ebitdaVal, ebitdaMargin: (ebitdaVal / annualRev) * 100 };
  }, [allTime]);

  const netReturnAtHorizon = pnlSeries[pnlSeries.length - 1]?.cumulative ?? 0;
  const monthlyProfit = monthlyRevenue - monthlyOpex;

  // Sensitivity: +10% revenue
  const sensitivityPnl = useMemo(() =>
    projectCumulativePnL({
      investment,
      horizonMonths,
      monthlyRevenue: monthlyRevenue * 1.1,
      monthlyOpex,
    }),
  [investment, horizonMonths, monthlyRevenue, monthlyOpex]);
  const sensitivityBreakEven = findBreakEvenMonth(sensitivityPnl);

  return (
    <div className={styles.tab}>

      {/* ── KPI Strip ─────────────────────────────────────────────────────── */}
      <div className={styles.kpiGrid}>
        <KpiCard
          icon={TrendingUp}
          label="ROI"
          value={roi !== null ? `${roi.toFixed(1)}%` : '—'}
          sub="Annual net profit / investment"
          healthColor={getHealthColor('roi', roi)}
        />
        <KpiCard
          icon={Clock}
          label="Payback Period"
          value={payback === Infinity ? '∞' : payback !== null ? `${payback.toFixed(1)} mo` : '—'}
          sub="Months to recoup investment"
          healthColor={getHealthColor('paybackMonths', payback)}
        />
        <KpiCard
          icon={BarChart2}
          label="EBITDA Margin"
          value={ebitda.ebitdaMargin !== null ? `${ebitda.ebitdaMargin.toFixed(1)}%` : '—'}
          sub={ebitda.ebitda !== null ? formatEURCompact(ebitda.ebitda) + ' / year' : 'No revenue data'}
          healthColor={getHealthColor('ebitdaMargin', ebitda.ebitdaMargin)}
        />
        <KpiCard
          icon={Target}
          label={`Net Return at M${horizonMonths}`}
          value={formatEURCompact(netReturnAtHorizon)}
          sub={breakEvenMonth ? `Breaks even at M${breakEvenMonth}` : 'Does not break even in horizon'}
          healthColor={netReturnAtHorizon >= 0 ? 'green' : netReturnAtHorizon > -investment * 0.5 ? 'amber' : 'red'}
        />
      </div>

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div className={styles.controls}>
        <div className={styles.controlGroup}>
          <label className={styles.controlLabel}>Planning Horizon</label>
          <div className={styles.horizonBtns}>
            {HORIZON_OPTIONS.map((h) => (
              <button
                key={h}
                className={`${styles.horizonBtn} ${horizonMonths === h ? styles.horizonBtnActive : ''}`}
                onClick={() => setHorizonMonths(h)}
              >
                {h}mo
              </button>
            ))}
          </div>
        </div>

        <div className={styles.inputsRow}>
          <div className={styles.inputGroup}>
            <label className={styles.inputLabel}>
              Initial Investment (€)
              <span className={styles.inputHint}>Auto: {formatEUR(baseInvestment, true)}</span>
            </label>
            <input
              type="number"
              inputMode="decimal"
              className={styles.input}
              placeholder={baseInvestment.toFixed(0)}
              value={investmentOverride}
              onChange={(e) => setInvestmentOverride(e.target.value)}
            />
          </div>
          <div className={styles.inputGroup}>
            <label className={styles.inputLabel}>
              Monthly Revenue (€)
              <span className={styles.inputHint}>Auto: {formatEUR(baseMonthlyRevenue, true)}</span>
            </label>
            <input
              type="number"
              inputMode="decimal"
              className={styles.input}
              placeholder={baseMonthlyRevenue.toFixed(0)}
              value={revenueOverride}
              onChange={(e) => setRevenueOverride(e.target.value)}
            />
          </div>
          <div className={styles.inputGroup}>
            <label className={styles.inputLabel}>
              Monthly OpEx (€)
              <span className={styles.inputHint}>Auto: {formatEUR(baseMonthlyOpex, true)}</span>
            </label>
            <input
              type="number"
              inputMode="decimal"
              className={styles.input}
              placeholder={baseMonthlyOpex.toFixed(0)}
              value={opexOverride}
              onChange={(e) => setOpexOverride(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* ── Chart ─────────────────────────────────────────────────────────── */}
      <div className={styles.chartCard}>
        <div className={styles.chartHeader}>
          <span className={styles.chartTitle}>Cumulative P&amp;L Projection</span>
          {sensitivityBreakEven && sensitivityBreakEven !== breakEvenMonth && (
            <span className={styles.sensitivityHint}>
              <Info size={13} />
              +10% revenue → break-even at M{sensitivityBreakEven}
            </span>
          )}
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={pnlSeries} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
              interval={Math.floor(horizonMonths / 12) - 1}
            />
            <YAxis
              tickFormatter={(v) => formatEURCompact(v)}
              tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
              width={70}
            />
            <Tooltip
              formatter={(v) => [formatEUR(v), 'Cumulative P&L']}
              contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8 }}
              labelStyle={{ color: 'var(--color-text-muted)', fontSize: 12 }}
            />
            <ReferenceLine y={0} stroke="var(--color-warning)" strokeDasharray="4 4" label={{ value: 'Break-even', position: 'insideTopLeft', fontSize: 11, fill: 'var(--color-warning)' }} />
            {breakEvenMonth && (
              <ReferenceLine
                x={`M${breakEvenMonth}`}
                stroke="var(--color-success)"
                strokeDasharray="4 4"
              />
            )}
            <Line
              type="monotone"
              dataKey="cumulative"
              stroke="var(--color-primary)"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ── Summary row ───────────────────────────────────────────────────── */}
      <div className={styles.summaryRow}>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Monthly profit (net)</span>
          <span className={`${styles.summaryValue} ${monthlyProfit >= 0 ? styles.positive : styles.negative}`}>
            {formatEUR(monthlyProfit)}
          </span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Total investment tracked</span>
          <span className={styles.summaryValue}>{formatEUR(investment)}</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Monthly revenue (net)</span>
          <span className={styles.summaryValue}>{formatEUR(monthlyRevenue)}</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Monthly OpEx</span>
          <span className={styles.summaryValue}>{formatEUR(monthlyOpex)}</span>
        </div>
      </div>

    </div>
  );
}
