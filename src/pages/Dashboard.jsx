import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Euro, Bike, TrendingUp, ListChecks, Target, DollarSign, Plus,
  TrendingDown, Activity, Users, BarChart2, Shield, Clock,
  Wrench, AlertTriangle, Package, FileDown, Calendar,
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
  revenuePerCityBreakdown, revenueBreakdown, operatingRevenue as calcOperatingRevenue,
  applyFinancialAdjustments,
} from '../utils/revenueCalculations.js';
import { forecastTrend } from '../utils/forecasting.js';
import { exportDashboardToPDF } from '../utils/exportData.js';
import {
  calcEBITDA, calcROI, calcDSCR, calcBreakEvenRevenue,
  calcPaybackPeriod, calcCostRecoveryRate, calcRevGrowthMoM,
  getHealthColor,
} from '../utils/financialHealth.js';
import { useProjects } from '../context/ProjectContext.jsx';
import { isPowDay, daysSince, relativeLabel } from '../utils/powHelpers.js';
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
    scooters,
    config: maintConfig,
  } = useMaintenance();
  const { activeProjects, archivedProjects } = useProjects();
  const navigate = useNavigate();

  // ── Financial config (Hopp fee, VAT, SIM) ────────────────────────────────
  const financial = config.financial || {
    applyFranchiseFee: true,
    franchiseRate: 0.19,
    vatRate: 0.24,
    monthlySimCost: 150,
  };

  const hasMaintenanceData   = tickets.length > 0 || parts.length > 0;
  const maxActiveTickets     = maintConfig?.maxActiveTickets ?? 3;

  const [viewMode,       setViewMode]       = useState('month'); // 'month' | 'range' | 'all'
  const [selectedMonth,  setSelectedMonth]  = useState(todayMonthStr);
  const [rangeFrom,      setRangeFrom]      = useState('');
  const [rangeTo,        setRangeTo]        = useState('');
  const [locationFilter, setLocationFilter] = useState('all');
  const [showForecast,   setShowForecast]   = useState(false);
  const [exportingPDF,   setExportingPDF]   = useState(false);
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
  // Include one-time costs for the selected period (excluded from normalizeToMonthly)
  const oneTimeInPeriod   = useMemo(() => {
    if (viewMode === 'month') {
      return periodCosts
        .filter((c) => c.frequency === 'one-time')
        .reduce((s, c) => s + (c.amount || 0), 0);
    }
    if (viewMode === 'range' && rangeFrom && rangeTo) {
      return filteredCosts
        .filter((c) => c.frequency === 'one-time' && c.startDate >= rangeFrom + '-01' && c.startDate <= rangeTo + '-31')
        .reduce((s, c) => s + (c.amount || 0), 0);
    }
    return filteredCosts
      .filter((c) => c.frequency === 'one-time')
      .reduce((s, c) => s + (c.amount || 0), 0);
  }, [viewMode, periodCosts, filteredCosts, rangeFrom, rangeTo]);
  const displayTotal      = monthlyCostRate * periodMonths + oneTimeInPeriod;
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
  const revBreakdown       = useMemo(
    () => revenueBreakdown(periodRevenue, financial, periodMonths),
    [periodRevenue, financial, periodMonths],
  );
  const displayRevenue     = revBreakdown.operatingRevenue;
  const displayPnL         = displayRevenue - displayTotal;
  const tripsPerDay        = avgTripsPerDay(periodRevenue);
  const revPerTrip         = revenuePerTrip(periodRevenue);
  const utilization        = vehicleUtilization(periodRevenue, config.fleetSize);
  const actualRevPerScooter= actualRevenuePerScooterMonthly(periodRevenue, config.fleetSize);
  const rawCombinedTrend   = hasRevenue
    ? (viewMode === 'all'
        ? allTimeCombinedTrend(filteredCosts, filteredRevenue)
        : combinedMonthlyTrend(trendData, filteredRevenue, chartYear))
    : null;

  const combinedTrend = useMemo(() => {
    if (!rawCombinedTrend) return null;
    const adjusted = applyFinancialAdjustments(rawCombinedTrend, financial);
    if (showForecast && viewMode !== 'month') return forecastTrend(adjusted, 3);
    return adjusted;
  }, [rawCombinedTrend, showForecast, viewMode, financial]);

  // C2 — Revenue by city breakdown
  const cityBreakdown = useMemo(() => {
    if (!hasRevenue || !locations.length) return [];
    return revenuePerCityBreakdown(periodRevenue, scooters, locations);
  }, [periodRevenue, scooters, locations, hasRevenue]);

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

  const ebitda      = hasPeriodData ? calcEBITDA(usedCosts, periodRevenue, financial)       : null;
  const roi         = hasPeriodData ? calcROI(usedCosts, periodRevenue, financial)           : null;
  const dscr        = hasPeriodData ? calcDSCR(usedCosts, periodRevenue, { ...config, monthlyDebtService: autoDebtService > 0 ? autoDebtService : null }, financial) : null;
  const breakEven   = calcBreakEvenRevenue(usedCosts);
  const payback     = hasPeriodData ? calcPaybackPeriod(usedCosts, periodRevenue, financial) : null;
  const costRecovery= hasPeriodData ? calcCostRecoveryRate(usedCosts, periodRevenue, financial) : null;

  const isEmpty = costs.length === 0;

  async function handleExportPDF() {
    setExportingPDF(true);
    // Replace em-dashes, en-dashes and spaces with hyphens (em dash from period range label)
    const safeLabel = periodLabel.replace(/[–—\s/]/g, '-').replace(/-+/g, '-').toLowerCase();
    await exportDashboardToPDF(`xslide-dashboard-${safeLabel}.pdf`);
    setExportingPDF(false);
  }

  // ── Period label for card titles ─────────────────────────────────────────
  const periodLabel = viewMode === 'month'
    ? fmtMonth(selectedMonth)
    : viewMode === 'range' && rangeFrom && rangeTo
      ? `${fmtMonth(rangeFrom)} – ${fmtMonth(rangeTo)}`
      : 'All Time';

  return (
    <div className={styles.page} id="dashboard-export">
      <Header
        title="Pulse"
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
                {rangeFrom && rangeTo && rangeFrom > rangeTo && (
                  <span style={{ color: 'var(--color-danger)', fontSize: 'var(--text-sm)' }}>
                    ⚠ "From" must be before "To"
                  </span>
                )}
              </>
            )}

            <LocationSelector locations={locations} value={locationFilter} onChange={setLocationFilter} />

            {/* Forecast toggle */}
            {hasRevenue && viewMode !== 'month' && (
              <Button
                variant={showForecast ? 'primary' : 'outline'}
                size="sm"
                onClick={() => setShowForecast((v) => !v)}
                title="Toggle 3-month linear regression forecast"
              >
                <TrendingUp size={14} /> {showForecast ? 'Forecast On' : 'Forecast'}
              </Button>
            )}

            {/* PDF export */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportPDF}
              disabled={exportingPDF}
            >
              <FileDown size={14} /> {exportingPDF ? 'Exporting…' : 'Export PDF'}
            </Button>
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
                  ? <RevenueCostTrend data={combinedTrend} showForecast={showForecast && viewMode !== 'month'} />
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
              label={`Net Revenue · ${periodLabel}`}
              value={formatEURCompact(displayRevenue)}
              sub={hasPeriodData
                ? `Gross ${formatEURCompact(revBreakdown.gross)}${financial.applyFranchiseFee ? ` · Hopp −${formatEURCompact(revBreakdown.hoppFee)}` : ''} · SIM −${formatEURCompact(revBreakdown.simCost)}`
                : 'No data for this period'}
              accent
            />
            <KpiCard
              icon={displayPnL >= 0 ? TrendingUp : TrendingDown}
              label={`Profit / Loss · ${periodLabel}`}
              value={formatEURCompact(displayPnL)}
              sub={
                totalRevenueLost > 0
                  ? `Net Rev ${formatEURCompact(displayRevenue)} − Costs ${formatEURCompact(displayTotal)} · Adj. P&L incl. maintenance risk: ${formatEURCompact(displayPnL - totalRevenueLost)}`
                  : `Net Rev ${formatEURCompact(displayRevenue)} − Costs ${formatEURCompact(displayTotal)}`
              }
              highlight
            />
            {hasPeriodData && financial.applyFranchiseFee && (
              <KpiCard
                icon={DollarSign}
                label={`Hopp Franchise Fee · ${periodLabel}`}
                value={formatEURCompact(revBreakdown.hoppFee)}
                sub={`${(financial.franchiseRate * 100).toFixed(0)}% of gross revenue`}
                healthColor="muted"
              />
            )}
            {hasPeriodData && (
              <KpiCard
                icon={Shield}
                label={`VAT Collected · ${periodLabel}`}
                value={formatEURCompact(revBreakdown.vatPortion)}
                sub="24% · held for government remittance"
                healthColor="muted"
              />
            )}
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

        {/* ── Revenue by City (C2) ── */}
        {cityBreakdown.length > 1 && (
          <div className={styles.chartCard}>
            <div className={styles.chartHeader}>
              <h2 className={styles.chartTitle}>Revenue by City · {periodLabel}</h2>
              <span className={styles.chartSub}>Performance breakdown per location</span>
            </div>
            <div className={styles.cityTable}>
              <div className={styles.cityRow} style={{ fontWeight: 600, color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                <span>City</span>
                <span style={{ textAlign: 'right' }}>Revenue</span>
                <span style={{ textAlign: 'right' }}>Trips</span>
                <span style={{ textAlign: 'right' }}>Active Scooters</span>
                <span style={{ textAlign: 'right' }}>Rev / Scooter</span>
              </div>
              {cityBreakdown.map((row) => (
                <div key={row.city} className={styles.cityRow}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-brand)', display: 'inline-block', flexShrink: 0 }} />
                    {row.city}
                  </span>
                  <span style={{ textAlign: 'right', fontWeight: 600 }}>{formatEUR(row.revenue)}</span>
                  <span style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>{row.trips.toLocaleString()}</span>
                  <span style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>{row.activeScooters}</span>
                  <span style={{ textAlign: 'right', color: row.revenuePerScooter != null ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                    {row.revenuePerScooter != null ? formatEUR(row.revenuePerScooter) : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Projects · At a Glance ── */}
        {activeProjects.length > 0 && (() => {
          const blockedCount      = activeProjects.filter((p) => p.effectiveStatus === 'blocked').length;
          const attentionCount    = activeProjects.filter((p) => p.effectiveStatus === 'needsAttention').length;
          const needsAttentionTotal = blockedCount + attentionCount;

          // POW entries this week (ISO week matching)
          const now        = new Date();
          const weekStart  = new Date(now);
          weekStart.setDate(now.getDate() - now.getDay() + 1); // Mon
          const weekKey    = weekStart.toISOString().slice(0, 10);
          const powThisWeek = activeProjects.reduce((n, p) =>
            n + (p.powEntries || []).filter((e) => e.weekOf >= weekKey).length, 0);

          // Projects needing attention, sorted by staleness
          const needsNow = [...activeProjects]
            .filter((p) => p.effectiveStatus === 'blocked' || p.effectiveStatus === 'needsAttention')
            .sort((a, b) => daysSince(a.updatedAt) - daysSince(b.updatedAt))
            .reverse()
            .slice(0, 3);

          return (
            <>
              {isPowDay() && (
                <div className={styles.powBanner}>
                  <span style={{ fontSize: 18 }}>📋</span>
                  <div>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: 'var(--text-sm)' }}>Today is POW day</p>
                    <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>Log your Progress of Week before closing the app.</p>
                  </div>
                </div>
              )}
              <div className={styles.revenueDivider}>
                <span className={styles.revenueDividerLabel}>Projects · At a Glance</span>
              </div>
              <div className={styles.kpiGrid}>
                <KpiCard
                  icon={ListChecks}
                  label="Active Projects"
                  value={activeProjects.length}
                  sub={`${archivedProjects.length} archived`}
                />
                <KpiCard
                  icon={AlertTriangle}
                  label="Needs Attention"
                  value={needsAttentionTotal}
                  sub={blockedCount > 0 ? `${blockedCount} blocked · ${attentionCount} at risk` : `${attentionCount} at risk`}
                  healthColor={blockedCount > 0 ? 'danger' : attentionCount > 0 ? 'warning' : 'good'}
                />
                <KpiCard
                  icon={Calendar}
                  label="POW This Week"
                  value={powThisWeek}
                  sub={powThisWeek === 0 ? 'No entries logged yet' : `${powThisWeek} entr${powThisWeek === 1 ? 'y' : 'ies'} this week`}
                  healthColor={powThisWeek > 0 ? 'good' : 'muted'}
                />
              </div>
              {needsNow.length > 0 && (
                <div className={styles.chartCard}>
                  <div className={styles.chartHeader}>
                    <h2 className={styles.chartTitle}>Needs You Now</h2>
                    <span className={styles.chartSub}>Projects requiring immediate attention</span>
                  </div>
                  <div className={styles.needsNowList}>
                    {needsNow.map((p) => {
                      const stale = daysSince(p.updatedAt);
                      const chipColor = stale >= 14 ? 'var(--color-danger)' : stale >= 7 ? 'var(--color-warning)' : 'var(--color-text-muted)';
                      const statusColor = p.effectiveStatus === 'blocked' ? 'var(--color-danger)' : 'var(--color-warning)';
                      return (
                        <div
                          key={p._docId}
                          className={styles.needsNowRow}
                          onClick={() => navigate(`/projects/${p._docId}`)}
                          style={{ cursor: 'pointer' }}
                        >
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, display: 'inline-block', flexShrink: 0, marginTop: 2 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</p>
                            <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.nextAction || 'No next action set'}
                            </p>
                          </div>
                          <span style={{ fontSize: 'var(--text-xs)', color: chipColor, whiteSpace: 'nowrap', flexShrink: 0 }}>
                            {relativeLabel(p.updatedAt)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          );
        })()}

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

            {/* Budget vs Actual bars */}
            {config.categoryBudgets && Object.keys(config.categoryBudgets).some((k) => config.categoryBudgets[k] != null) && (
              <div className={styles.budgetSection}>
                <h3 className={styles.budgetTitle}>Budget vs Actual</h3>
                {Object.entries(config.categoryBudgets)
                  .filter(([, budget]) => budget != null && budget > 0)
                  .map(([cat, budget]) => {
                    const actual = breakdown[cat] || 0;
                    const pct    = Math.min(100, Math.round((actual / budget) * 100));
                    const over   = actual > budget;
                    return (
                      <div key={cat} className={styles.budgetRow}>
                        <span className={styles.budgetCat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</span>
                        <div className={styles.budgetBarWrap}>
                          <div
                            className={styles.budgetBarFill}
                            style={{
                              width: `${pct}%`,
                              background: over ? '#ef4444' : pct > 80 ? '#f59e0b' : '#22c55e',
                            }}
                          />
                        </div>
                        <span className={`${styles.budgetAmt} ${over ? styles.budgetOver : ''}`}>
                          {formatEUR(actual)} / {formatEUR(budget)}
                        </span>
                      </div>
                    );
                  })}
              </div>
            )}
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
