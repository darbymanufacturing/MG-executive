import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Euro, Bike, TrendingUp, ListChecks, Target, DollarSign, Plus,
  TrendingDown, Activity, Users, BarChart2, Shield, Clock,
  Wrench, AlertTriangle, Package,
} from 'lucide-react';
import Header from '../components/Layout/Header.jsx';
import KpiCard from '../components/Dashboard/KpiCard.jsx';
import CostBreakdownChart from '../components/Dashboard/CostBreakdownChart.jsx';
import MonthlyCostTrend from '../components/Dashboard/MonthlyCostTrend.jsx';
import RevenueCostTrend from '../components/Dashboard/RevenueCostTrend.jsx';
import DailyRevenueTrend from '../components/Dashboard/DailyRevenueTrend.jsx';
import Button from '../components/Shared/Button.jsx';
import LocationSelector from '../components/Shared/LocationSelector.jsx';
import { useCosts } from '../context/CostContext.jsx';
import { useRevenue } from '../context/RevenueContext.jsx';
import { useMaintenance } from '../context/MaintenanceContext.jsx';
import {
  totalMonthlyCost, totalAnnualCost,
  costPerScooterMonthly, costPerScooterDaily, costPerScooterAnnual,
  breakdownByCategory, monthlyTrendData, budgetVariance, filterCostsByLocation,
  allTimeMonthlyTrendData, normalizeToMonthly,
} from '../utils/calculations.js';
import {
  totalRevenue, avgTripsPerDay, revenuePerTrip,
  vehicleUtilization, combinedMonthlyTrend, actualRevenuePerScooterMonthly,
  filterRevenueByLocation, allTimeCombinedTrend, dailyRevenueTrend,
} from '../utils/revenueCalculations.js';
import {
  calcEBITDA, calcROI, calcDSCR, calcBreakEvenRevenue,
  calcPaybackPeriod, calcCostRecoveryRate, calcRevGrowthMoM,
  getHealthColor,
} from '../utils/financialHealth.js';
import { formatEUR, formatEURCompact, formatPercent, formatTrips } from '../utils/formatters.js';
import styles from './Dashboard.module.css';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtMonth(s) {
  if (!s) return '';
  const [y, m] = s.split('-');
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
}

function todayMonthStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const selectStyle = {
  background: 'var(--color-surface-2)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--text-sm)',
  padding: '7px 10px',
  outline: 'none',
  cursor: 'pointer',
};

export default function Dashboard() {
  const { costs, config, loadSampleData } = useCosts();
  const { revenueData } = useRevenue();
  const {
    totalRevenueLost,
    activeCount,
    lowStockParts,
    tickets,
    parts,
    config: maintConfig,
  } = useMaintenance();
  const navigate = useNavigate();

  const hasMaintenanceData   = tickets.length > 0 || parts.length > 0;
  const maxActiveTickets     = maintConfig?.maxActiveTickets ?? 3;

  const [viewMode,      setViewMode]      = useState('month'); // 'month' | 'range' | 'all'
  const [selectedMonth, setSelectedMonth] = useState(todayMonthStr);
  const [rangeFrom,     setRangeFrom]     = useState('');
  const [rangeTo,       setRangeTo]       = useState('');
  const [locationFilter, setLocationFilter] = useState('all');
  const locations = config.locations || [];

  // ── Location-filtered base arrays ─────────────────────────────────────────
  const filteredCosts   = useMemo(() => filterCostsByLocation(costs, locationFilter),         [costs, locationFilter]);
  const filteredRevenue = useMemo(() => filterRevenueByLocation(revenueData, locationFilter), [revenueData, locationFilter]);

  // ── Available months for selectors ───────────────────────────────────────
  const availableMonths = useMemo(() => {
    const months = new Set([todayMonthStr(), ...filteredRevenue.map((r) => r.date.slice(0, 7))]);
    return [...months].sort((a, b) => b.localeCompare(a)); // newest first
  }, [filteredRevenue]);

  // ── Period-filtered revenue ───────────────────────────────────────────────
  const periodRevenue = useMemo(() => {
    if (viewMode === 'month') {
      return filteredRevenue.filter((r) => r.date.startsWith(selectedMonth));
    }
    if (viewMode === 'range') {
      return filteredRevenue.filter((r) => {
        const d = r.date;
        return (!rangeFrom || d >= rangeFrom + '-01') && (!rangeTo || d <= rangeTo + '-31');
      });
    }
    return filteredRevenue;
  }, [filteredRevenue, viewMode, selectedMonth, rangeFrom, rangeTo]);

  // ── Period-filtered costs (active in selected month) ─────────────────────
  const periodCosts = useMemo(() => {
    if (viewMode !== 'month' || !selectedMonth) return filteredCosts;
    const [y, m] = selectedMonth.split('-').map(Number);
    const monthIdx = m - 1;
    const monthStart = new Date(y, monthIdx, 1);
    const monthEnd   = new Date(y, monthIdx + 1, 0);
    return filteredCosts.filter((c) => {
      const start = c.startDate ? new Date(c.startDate) : null;
      const end   = c.endDate   ? new Date(c.endDate)   : null;
      if (c.frequency === 'one-time') {
        return start && start.getFullYear() === y && start.getMonth() === monthIdx;
      }
      return (start ? start <= monthEnd : true) && (end ? end >= monthStart : true);
    });
  }, [filteredCosts, viewMode, selectedMonth]);

  // ── Period span (months count for range) ─────────────────────────────────
  const periodMonths = useMemo(() => {
    if (viewMode === 'month') return 1;
    if (viewMode === 'range' && rangeFrom && rangeTo) {
      const [fy, fm] = rangeFrom.split('-').map(Number);
      const [ty, tm] = rangeTo.split('-').map(Number);
      return Math.max(1, (ty - fy) * 12 + (tm - fm) + 1);
    }
    return 1;
  }, [viewMode, rangeFrom, rangeTo]);

  // ── Chart year (drives the trend chart) ──────────────────────────────────
  const chartYear = useMemo(() => {
    if (viewMode === 'month') return parseInt(selectedMonth.split('-')[0], 10);
    if (viewMode === 'range' && rangeTo) return parseInt(rangeTo.split('-')[0], 10);
    return new Date().getFullYear();
  }, [viewMode, selectedMonth, rangeTo]);

  const hasRevenue     = filteredRevenue.length > 0;      // any revenue for chart
  const hasPeriodData  = periodRevenue.length > 0;         // revenue in selected period

  // ── Cost metrics ─────────────────────────────────────────────────────────
  const monthlyCostRate   = totalMonthlyCost(viewMode === 'month' ? periodCosts : filteredCosts);
  const displayTotal      = monthlyCostRate * periodMonths;
  const annualTotal       = totalAnnualCost(filteredCosts);
  const perScooterMonthly = costPerScooterMonthly(filteredCosts, config.fleetSize);
  const perScooterDaily   = costPerScooterDaily(filteredCosts, config.fleetSize);
  const perScooterAnnual  = costPerScooterAnnual(filteredCosts, config.fleetSize);
  const breakdown         = breakdownByCategory(viewMode === 'month' ? periodCosts : filteredCosts);
  const trendData         = viewMode === 'all'
    ? allTimeMonthlyTrendData(filteredCosts)
    : monthlyTrendData(filteredCosts, chartYear);
  const budgetVar         = budgetVariance(perScooterMonthly, config.targetCostPerScooter);

  // ── Revenue metrics ───────────────────────────────────────────────────────
  const displayRevenue     = totalRevenue(periodRevenue);
  const displayPnL         = displayRevenue - displayTotal;
  const tripsPerDay        = avgTripsPerDay(periodRevenue);
  const revPerTrip         = revenuePerTrip(periodRevenue);
  const utilization        = vehicleUtilization(periodRevenue, config.fleetSize);
  const actualRevPerScooter= actualRevenuePerScooterMonthly(periodRevenue, config.fleetSize);
  const combinedTrend      = hasRevenue
    ? (viewMode === 'all'
        ? allTimeCombinedTrend(filteredCosts, filteredRevenue)
        : combinedMonthlyTrend(trendData, filteredRevenue, chartYear))
    : null;

  // Daily breakdown — only computed for "By Month" view
  const dailyTrendData = useMemo(
    () => viewMode === 'month' ? dailyRevenueTrend(periodRevenue, filteredCosts, selectedMonth) : [],
    [viewMode, periodRevenue, filteredCosts, selectedMonth],
  );

  // Monthly revenue rate for break-even comparison
  const periodMonthlyRevenue = hasPeriodData
    ? totalRevenue(periodRevenue) / periodMonths
    : 0;

  // MoM growth only meaningful with multiple months
  const revGrowthMoM = viewMode !== 'month' && hasPeriodData
    ? calcRevGrowthMoM(periodRevenue)
    : null;

  // ── Financial health metrics ──────────────────────────────────────────────
  const usedCosts   = viewMode === 'month' ? periodCosts : filteredCosts;

  const autoDebtService = useMemo(() =>
    usedCosts
      .filter((c) => c.category === 'loan' || c.category === 'credit-card')
      .reduce((sum, c) => sum + normalizeToMonthly(c), 0),
  [usedCosts]);

  const ebitda      = hasPeriodData ? calcEBITDA(usedCosts, periodRevenue)       : null;
  const roi         = hasPeriodData ? calcROI(usedCosts, periodRevenue)           : null;
  const dscr        = hasPeriodData ? calcDSCR(usedCosts, periodRevenue, { ...config, monthlyDebtService: autoDebtService > 0 ? autoDebtService : null }) : null;
  const breakEven   = calcBreakEvenRevenue(usedCosts);
  const payback     = hasPeriodData ? calcPaybackPeriod(usedCosts, periodRevenue) : null;
  const costRecovery= hasPeriodData ? calcCostRecoveryRate(usedCosts, periodRevenue) : null;

  const isEmpty = costs.length === 0;

  // ── Period label for card titles ─────────────────────────────────────────
  const periodLabel = viewMode === 'month'
    ? fmtMonth(selectedMonth)
    : viewMode === 'range' && rangeFrom && rangeTo
      ? `${fmtMonth(rangeFrom)} – ${fmtMonth(rangeTo)}`
      : 'All Time';

  return (
    <div className={styles.page} id="dashboard-export">
      <Header
        title="Dashboard"
        subtitle={`Fleet overview · ${config.fleetSize} scooters`}
        actions={
          <div className={styles.headerActions}>
            {/* View mode toggle */}
            <div className={styles.periodToggle}>
              {[['month', 'By Month'], ['range', 'Range'], ['all', 'All Time']].map(([mode, label]) => (
                <button
                  key={mode}
                  className={`${styles.periodBtn} ${viewMode === mode ? styles.periodActive : ''}`}
                  onClick={() => setViewMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Month picker */}
            {viewMode === 'month' && (
              <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} style={selectStyle}>
                {availableMonths.map((m) => (
                  <option key={m} value={m}>{fmtMonth(m)}</option>
                ))}
              </select>
            )}

            {/* Range pickers */}
            {viewMode === 'range' && (
              <>
                <select value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} style={selectStyle}>
                  <option value="">From…</option>
                  {[...availableMonths].reverse().map((m) => (
                    <option key={m} value={m}>{fmtMonth(m)}</option>
                  ))}
                </select>
                <span className={styles.rangeArrow}>→</span>
                <select value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} style={selectStyle}>
                  <option value="">To…</option>
                  {availableMonths.map((m) => (
                    <option key={m} value={m}>{fmtMonth(m)}</option>
                  ))}
                </select>
              </>
            )}

            <LocationSelector locations={locations} value={locationFilter} onChange={setLocationFilter} />
          </div>
        }
      />

      <div className={styles.content}>
        {isEmpty && (
          <div className={styles.emptyBanner}>
            <div>
              <strong>No data yet.</strong> Load sample data or go to Cost Manager to add your first cost.
            </div>
            <div className={styles.emptyActions}>
              <Button variant="outline" size="sm" onClick={loadSampleData}>Load Sample Data</Button>
              <Button variant="primary" size="sm" onClick={() => navigate('/costs')}>
                <Plus size={14} /> Add Costs
              </Button>
            </div>
          </div>
        )}

        {/* ── Revenue vs. Costs chart — full width, top ── */}
        {(hasRevenue || !isEmpty) && (
          <div className={styles.chartCardFull}>
            <div className={styles.chartHeader}>
              <h2 className={styles.chartTitle}>
                {hasRevenue
                  ? (viewMode === 'month' ? `Daily Revenue · ${fmtMonth(selectedMonth)}` : 'Revenue vs. Costs')
                  : 'Monthly Cost Trend'}
              </h2>
              <span className={styles.chartSub}>
                {hasRevenue
                  ? viewMode === 'month'
                    ? 'Revenue bars per day · dashed line = daily cost rate'
                    : viewMode === 'all'
                      ? 'All time · Revenue line + cost bars + profit/loss'
                      : `${chartYear} · Revenue line + cost bars + profit/loss`
                  : viewMode === 'all'
                    ? 'All time · Stacked by category'
                    : `${chartYear} · Stacked by category`}
              </span>
            </div>
            <div className={styles.chartFull}>
              {hasRevenue && viewMode === 'month'
                ? <DailyRevenueTrend data={dailyTrendData} />
                : hasRevenue
                  ? <RevenueCostTrend data={combinedTrend} />
                  : <MonthlyCostTrend data={trendData} />
              }
            </div>
          </div>
        )}

        {/* ── Cost KPI Cards ── */}
        <div className={styles.kpiGrid}>
          <KpiCard
            icon={Euro}
            label={`Total Cost · ${periodLabel}`}
            value={formatEURCompact(displayTotal)}
            sub={`${formatEURCompact(annualTotal)}/year estimate`}
            accent
          />
          <KpiCard
            icon={Bike}
            label="Cost per Scooter / Month"
            value={formatEUR(perScooterMonthly)}
            sub={`${formatEUR(perScooterDaily)}/day`}
            highlight
            trend={budgetVar}
          />
          <KpiCard
            icon={ListChecks}
            label="Active Cost Items"
            value={filteredCosts.length}
            sub={`${Object.keys(breakdown).length} categories`}
          />
          <KpiCard
            icon={Target}
            label="Fleet Size"
            value={config.fleetSize}
            sub="scooters in operation"
          />
          {config.targetCostPerScooter && (
            <KpiCard
              icon={TrendingUp}
              label="Budget Target / Scooter"
              value={formatEUR(config.targetCostPerScooter)}
              sub="per month"
              trend={budgetVar}
            />
          )}
        </div>

        {/* ── Revenue KPI Cards ── */}
        {hasRevenue && (
          <div className={styles.revenueDivider}>
            <span className={styles.revenueDividerLabel}>Revenue & Operations · {periodLabel}</span>
          </div>
        )}
        {hasRevenue && (
          <div className={styles.kpiGrid}>
            <KpiCard
              icon={TrendingUp}
              label={`Revenue · ${periodLabel}`}
              value={formatEURCompact(displayRevenue)}
              sub={hasPeriodData ? `${formatEURCompact(totalRevenue(filteredRevenue))} all time` : 'No data for this period'}
              accent
            />
            <KpiCard
              icon={displayPnL >= 0 ? TrendingUp : TrendingDown}
              label={`Profit / Loss · ${periodLabel}`}
              value={formatEURCompact(displayPnL)}
              sub={
                totalRevenueLost > 0
                  ? `Revenue ${formatEURCompact(displayRevenue)} − Costs ${formatEURCompact(displayTotal)} · Adj. P&L incl. maintenance risk: ${formatEURCompact(displayPnL - totalRevenueLost)}`
                  : `Revenue ${formatEURCompact(displayRevenue)} − Costs ${formatEURCompact(displayTotal)}`
              }
              highlight
            />
            <KpiCard
              icon={DollarSign}
              label="Revenue / Scooter / Month"
              value={formatEUR(actualRevPerScooter)}
              sub="Actual from data"
            />
            <KpiCard
              icon={Activity}
              label="Avg Trips / Day"
              value={formatTrips(tripsPerDay)}
              sub={`${formatEUR(revPerTrip)} per trip`}
            />
            <KpiCard
              icon={Users}
              label="Vehicle Utilization"
              value={formatPercent(utilization)}
              sub={`of ${config.fleetSize} scooters active`}
            />
          </div>
        )}

        {/* ── Maintenance KPI Cards ── */}
        {hasMaintenanceData && (
          <>
            <div className={styles.revenueDivider}>
              <span className={styles.revenueDividerLabel}>Maintenance · Live Status</span>
            </div>
            <div className={styles.kpiGrid}>
              <KpiCard
                icon={Wrench}
                label="Revenue at Risk"
                value={formatEURCompact(totalRevenueLost)}
                sub={totalRevenueLost > 0 ? 'From scooters currently in repair' : 'No open tickets with revenue loss'}
                healthColor={totalRevenueLost > 500 ? 'danger' : totalRevenueLost > 0 ? 'warning' : 'good'}
              />
              <KpiCard
                icon={AlertTriangle}
                label="Active Repair Tickets"
                value={`${activeCount} / ${maxActiveTickets}`}
                sub={activeCount >= maxActiveTickets ? '⚠ At maximum active limit' : `${maxActiveTickets - activeCount} slot${maxActiveTickets - activeCount !== 1 ? 's' : ''} remaining`}
                healthColor={activeCount >= maxActiveTickets ? 'warning' : activeCount > 0 ? 'muted' : 'good'}
              />
              <KpiCard
                icon={Package}
                label="Parts Low Stock"
                value={lowStockParts.length}
                sub={lowStockParts.length > 0 ? `${lowStockParts.map((p) => p.sku).slice(0, 2).join(', ')}${lowStockParts.length > 2 ? ` +${lowStockParts.length - 2} more` : ''}` : 'All parts above reorder point'}
                healthColor={lowStockParts.length > 3 ? 'danger' : lowStockParts.length > 0 ? 'warning' : 'good'}
              />
            </div>
          </>
        )}

        {/* ── Financial Health KPIs ── */}
        {hasPeriodData && (
          <>
            <div className={styles.revenueDivider}>
              <span className={styles.revenueDividerLabel}>Financial Health · {periodLabel}</span>
            </div>
            <div className={styles.kpiGrid}>
              <KpiCard
                icon={BarChart2}
                label="EBITDA Margin"
                value={ebitda?.ebitdaMargin !== null ? `${ebitda.ebitdaMargin.toFixed(1)}%` : 'N/A'}
                sub={ebitda?.ebitda !== null ? `${formatEURCompact(ebitda.ebitda)}/yr operating profit` : 'No revenue data'}
                healthColor={ebitda ? getHealthColor('ebitdaMargin', ebitda.ebitdaMargin) : 'muted'}
              />
              <KpiCard
                icon={TrendingUp}
                label="ROI"
                value={roi !== null ? `${roi.toFixed(1)}%` : 'N/A'}
                sub={roi !== null ? 'Return on investment costs' : 'No investment costs entered'}
                healthColor={getHealthColor('roi', roi)}
              />
              <KpiCard
                icon={Shield}
                label="DSCR"
                value={dscr !== null ? dscr.toFixed(2) : 'N/A'}
                sub={dscr !== null
                  ? (dscr >= 1.25 ? 'Comfortably covering debt' : dscr >= 1 ? 'Just covering debt' : 'At risk — below 1.0')
                  : 'Set monthly debt service in Settings'}
                healthColor={getHealthColor('dscr', dscr)}
              />
              <KpiCard
                icon={Clock}
                label="Payback Period"
                value={payback === null ? 'N/A' : payback === Infinity ? '∞' : `${Math.ceil(payback)} mo`}
                sub={payback === null ? 'No investment costs' : payback === Infinity ? 'Not profitable yet' : 'To recover all investments'}
                healthColor={getHealthColor('paybackMonths', payback)}
              />
            </div>

            {/* Break-even wide card */}
            <div className={styles.breakEvenCard}>
              <div className={styles.breakEvenMain}>
                <span className={styles.breakEvenLabel}>Break-Even Revenue</span>
                <span className={styles.breakEvenValue}>{formatEUR(breakEven)}/mo</span>
                <span className={styles.breakEvenSub}>Minimum monthly revenue needed to cover all costs</span>
              </div>
              <div className={styles.breakEvenStatus}>
                <div className={`${styles.breakEvenPill} ${periodMonthlyRevenue >= breakEven ? styles.breakEvenGreen : styles.breakEvenRed}`}>
                  {periodMonthlyRevenue >= breakEven
                    ? `+${formatEURCompact(periodMonthlyRevenue - breakEven)} above break-even`
                    : `${formatEURCompact(breakEven - periodMonthlyRevenue)} short of break-even`}
                </div>
                {revGrowthMoM !== null && (
                  <div className={styles.revGrowth}>
                    MoM Revenue Growth:{' '}
                    <strong style={{ color: revGrowthMoM >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                      {revGrowthMoM >= 0 ? '+' : ''}{revGrowthMoM.toFixed(1)}%
                    </strong>
                  </div>
                )}
                {costRecovery !== null && (
                  <div className={styles.revGrowth}>
                    Cost Recovery:{' '}
                    <strong style={{ color: costRecovery >= 1 ? 'var(--color-success)' : 'var(--color-warning)' }}>
                      {(costRecovery * 100).toFixed(0)}%
                    </strong>
                    {' '}({costRecovery >= 1 ? 'profitable' : 'below break-even'})
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── Bottom row: Cost Breakdown + Per-Scooter Economics ── */}
        <div className={styles.chartsGrid}>
          <div className={styles.chartCard}>
            <div className={styles.chartHeader}>
              <h2 className={styles.chartTitle}>Cost Breakdown</h2>
              <span className={styles.chartSub}>By category · {periodLabel}</span>
            </div>
            <CostBreakdownChart breakdown={breakdown} />
          </div>

          <div className={styles.chartCard}>
            <div className={styles.chartHeader}>
              <h2 className={styles.chartTitle}>Per-Scooter Economics</h2>
              <span className={styles.chartSub}>Monthly rates</span>
            </div>
            <div className={styles.economicsGrid}>
              <div className={styles.econItem}>
                <span className={styles.econLabel}>Cost / Month</span>
                <span className={styles.econValue}>{formatEUR(perScooterMonthly)}</span>
              </div>
              <div className={styles.econItem}>
                <span className={styles.econLabel}>Cost / Day</span>
                <span className={styles.econValue}>{formatEUR(perScooterDaily)}</span>
              </div>
              <div className={styles.econItem}>
                <span className={styles.econLabel}>Cost / Year</span>
                <span className={styles.econValue}>{formatEUR(perScooterAnnual)}</span>
              </div>

              {hasPeriodData && actualRevPerScooter !== null && (
                <>
                  <div className={styles.econDivider} />
                  <div className={styles.econItem}>
                    <span className={styles.econLabel}>Revenue / Scooter</span>
                    <span className={styles.econValue} style={{ color: 'var(--color-success)' }}>
                      {formatEUR(actualRevPerScooter)}
                    </span>
                  </div>
                  <div className={styles.econItem}>
                    <span className={styles.econLabel}>Gross Margin</span>
                    <span className={styles.econValue}
                      style={{ color: actualRevPerScooter - perScooterMonthly >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                      {formatEUR(actualRevPerScooter - perScooterMonthly)}
                    </span>
                  </div>
                  <div className={styles.econItem}>
                    <span className={styles.econLabel}>Margin %</span>
                    <span className={styles.econValue}>
                      {actualRevPerScooter > 0
                        ? `${(((actualRevPerScooter - perScooterMonthly) / actualRevPerScooter) * 100).toFixed(1)}%`
                        : '—'}
                    </span>
                  </div>
                </>
              )}

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
