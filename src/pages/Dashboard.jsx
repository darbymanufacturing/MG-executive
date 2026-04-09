import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Euro, Bike, TrendingUp, ListChecks, Target, DollarSign, Plus,
  TrendingDown, Activity, Users, BarChart2, Shield, Clock,
} from 'lucide-react';
import Header from '../components/Layout/Header.jsx';
import KpiCard from '../components/Dashboard/KpiCard.jsx';
import CostBreakdownChart from '../components/Dashboard/CostBreakdownChart.jsx';
import MonthlyCostTrend from '../components/Dashboard/MonthlyCostTrend.jsx';
import RevenueCostTrend from '../components/Dashboard/RevenueCostTrend.jsx';
import Button from '../components/Shared/Button.jsx';
import LocationSelector from '../components/Shared/LocationSelector.jsx';
import { useCosts } from '../context/CostContext.jsx';
import { useRevenue } from '../context/RevenueContext.jsx';
import {
  totalMonthlyCost, totalAnnualCost,
  costPerScooterMonthly, costPerScooterDaily, costPerScooterAnnual,
  breakdownByCategory, monthlyTrendData, budgetVariance, filterCostsByLocation,
} from '../utils/calculations.js';
import {
  totalRevenue, currentMonthRevenue, avgTripsPerDay, revenuePerTrip,
  vehicleUtilization, combinedMonthlyTrend, actualRevenuePerScooterMonthly,
  filterRevenueByLocation,
} from '../utils/revenueCalculations.js';
import {
  calcEBITDA, calcROI, calcDSCR, calcBreakEvenRevenue,
  calcPaybackPeriod, calcCostRecoveryRate, calcRevGrowthMoM,
  getHealthColor,
} from '../utils/financialHealth.js';
import { formatEUR, formatEURCompact, formatPercent, formatTrips } from '../utils/formatters.js';
import styles from './Dashboard.module.css';

const PERIODS = ['Monthly', 'Quarterly', 'Annual'];

export default function Dashboard() {
  const { costs, config, loadSampleData } = useCosts();
  const { revenueData } = useRevenue();
  const navigate = useNavigate();
  const [period, setPeriod] = useState('Monthly');
  const [locationFilter, setLocationFilter] = useState('all');
  const locations = config.locations || [];

  const currentYear = new Date().getFullYear();
  const availableYears = useMemo(() => {
    const years = new Set([currentYear, ...revenueData.map((r) => parseInt(r.date.slice(0, 4), 10))]);
    return [...years].filter(Boolean).sort((a, b) => b - a);
  }, [revenueData, currentYear]);
  const [selectedYear, setSelectedYear] = useState(currentYear);

  // ── Location-filtered arrays (upstream filtering) ─────────────────────────
  const filteredCosts   = useMemo(() => filterCostsByLocation(costs, locationFilter),   [costs, locationFilter]);
  const filteredRevenue = useMemo(() => filterRevenueByLocation(revenueData, locationFilter), [revenueData, locationFilter]);

  const multiplier = period === 'Monthly' ? 1 : period === 'Quarterly' ? 3 : 12;
  const hasRevenue = filteredRevenue.length > 0;

  // ── Cost metrics ─────────────────────────────────────────────────────────
  const monthlyTotal       = totalMonthlyCost(filteredCosts);
  const annualTotal        = totalAnnualCost(filteredCosts);
  const perScooterMonthly  = costPerScooterMonthly(filteredCosts, config.fleetSize);
  const perScooterDaily    = costPerScooterDaily(filteredCosts, config.fleetSize);
  const perScooterAnnual   = costPerScooterAnnual(filteredCosts, config.fleetSize);
  const breakdown          = breakdownByCategory(filteredCosts);
  const trendData          = monthlyTrendData(filteredCosts, selectedYear);
  const budgetVar          = budgetVariance(perScooterMonthly, config.targetCostPerScooter);
  const displayTotal       = period === 'Annual' ? annualTotal : monthlyTotal * multiplier;
  const displayPerScooter  = period === 'Annual' ? perScooterAnnual : perScooterMonthly * multiplier;

  // ── Revenue metrics ───────────────────────────────────────────────────────
  const monthlyRevenue     = currentMonthRevenue(filteredRevenue);
  const displayRevenue     = period === 'Annual'
    ? totalRevenue(filteredRevenue)
    : period === 'Quarterly' ? monthlyRevenue * 3 : monthlyRevenue;
  const displayPnL         = displayRevenue - displayTotal;
  const tripsPerDay        = avgTripsPerDay(filteredRevenue);
  const revPerTrip         = revenuePerTrip(filteredRevenue);
  const utilization        = vehicleUtilization(filteredRevenue, config.fleetSize);
  const actualRevPerScooter= actualRevenuePerScooterMonthly(filteredRevenue, config.fleetSize);
  const combinedTrend      = hasRevenue ? combinedMonthlyTrend(trendData, filteredRevenue, selectedYear) : null;

  // ── Financial health metrics ──────────────────────────────────────────────
  const ebitda       = hasRevenue ? calcEBITDA(filteredCosts, filteredRevenue) : null;
  const roi          = hasRevenue ? calcROI(filteredCosts, filteredRevenue) : null;
  const dscr         = hasRevenue ? calcDSCR(filteredCosts, filteredRevenue, config) : null;
  const breakEven    = calcBreakEvenRevenue(filteredCosts);
  const payback      = hasRevenue ? calcPaybackPeriod(filteredCosts, filteredRevenue) : null;
  const costRecovery = hasRevenue ? calcCostRecoveryRate(filteredCosts, filteredRevenue) : null;
  const revGrowthMoM = hasRevenue ? calcRevGrowthMoM(filteredRevenue) : null;

  const isEmpty = costs.length === 0;

  return (
    <div className={styles.page} id="dashboard-export">
      <Header
        title="Dashboard"
        subtitle={`Fleet overview · ${config.fleetSize} scooters`}
        actions={
          <div className={styles.headerActions}>
            <div className={styles.periodToggle}>
              {PERIODS.map((p) => (
                <button
                  key={p}
                  className={`${styles.periodBtn} ${period === p ? styles.periodActive : ''}`}
                  onClick={() => setPeriod(p)}
                >
                  {p}
                </button>
              ))}
            </div>
            {availableYears.length > 1 && (
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 'var(--text-sm)',
                  padding: '7px 10px',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                {availableYears.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            )}
            <LocationSelector locations={locations} value={locationFilter} onChange={setLocationFilter} />
          </div>
        }
      />

      <div className={styles.content}>
        {isEmpty && (
          <div className={styles.emptyBanner}>
            <div>
              <strong>No data yet.</strong> Load sample data to see the dashboard in action, or go to Cost Manager to add your first cost.
            </div>
            <div className={styles.emptyActions}>
              <Button variant="outline" size="sm" onClick={loadSampleData}>Load Sample Data</Button>
              <Button variant="primary" size="sm" onClick={() => navigate('/costs')}>
                <Plus size={14} /> Add Costs
              </Button>
            </div>
          </div>
        )}

        {/* ── Cost KPI Cards ── */}
        <div className={styles.kpiGrid}>
          <KpiCard
            icon={Euro}
            label={`Total ${period} Cost`}
            value={formatEURCompact(displayTotal)}
            sub={period !== 'Annual' ? `${formatEURCompact(annualTotal)}/year` : `${formatEURCompact(monthlyTotal)}/month`}
            accent
          />
          <KpiCard
            icon={Bike}
            label={`Cost per Scooter · ${period}`}
            value={formatEUR(displayPerScooter)}
            sub={`${formatEUR(perScooterDaily)}/day`}
            highlight
            trend={period === 'Monthly' ? budgetVar : null}
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

        {/* ── Revenue KPI Cards (only when revenue data exists) ── */}
        {hasRevenue && (
          <div className={styles.revenueDivider}>
            <span className={styles.revenueDividerLabel}>Revenue & Operations</span>
          </div>
        )}
        {hasRevenue && (
          <div className={styles.kpiGrid}>
            <KpiCard
              icon={TrendingUp}
              label={`Total ${period} Revenue`}
              value={formatEURCompact(displayRevenue)}
              sub={`${formatEURCompact(totalRevenue(filteredRevenue))} all time`}
              accent
            />
            <KpiCard
              icon={displayPnL >= 0 ? TrendingUp : TrendingDown}
              label={`${period} Profit / Loss`}
              value={formatEURCompact(displayPnL)}
              sub={`Revenue ${formatEURCompact(displayRevenue)} − Costs ${formatEURCompact(displayTotal)}`}
              highlight
            />
            <KpiCard
              icon={DollarSign}
              label="Revenue / Scooter / Month"
              value={formatEUR(actualRevPerScooter)}
              sub={config.revenuePerScooter
                ? `Estimated: ${formatEUR(config.revenuePerScooter)}`
                : 'Actual from data'}
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

        {/* ── Financial Health KPIs ── */}
        {hasRevenue && (
          <>
            <div className={styles.revenueDivider}>
              <span className={styles.revenueDividerLabel}>Financial Health</span>
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
                <div className={`${styles.breakEvenPill} ${monthlyRevenue >= breakEven ? styles.breakEvenGreen : styles.breakEvenRed}`}>
                  {monthlyRevenue >= breakEven
                    ? `+${formatEURCompact(monthlyRevenue - breakEven)} above break-even`
                    : `${formatEURCompact(breakEven - monthlyRevenue)} short of break-even`}
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

        {/* ── Charts ── */}
        <div className={styles.chartsGrid}>
          <div className={styles.chartCard}>
            <div className={styles.chartHeader}>
              <h2 className={styles.chartTitle}>Cost Breakdown</h2>
              <span className={styles.chartSub}>By category · {period}</span>
            </div>
            <CostBreakdownChart breakdown={breakdown} />
          </div>

          <div className={styles.chartCard}>
            <div className={styles.chartHeader}>
              <h2 className={styles.chartTitle}>
                {hasRevenue ? 'Revenue vs. Costs' : 'Monthly Cost Trend'}
              </h2>
              <span className={styles.chartSub}>
                {hasRevenue ? 'Revenue line + cost bars + profit/loss' : 'Current year, stacked by category'}
              </span>
            </div>
            {hasRevenue
              ? <RevenueCostTrend data={combinedTrend} />
              : <MonthlyCostTrend data={trendData} />
            }
          </div>
        </div>

        {/* ── Per-Scooter Economics ── */}
        <div className={styles.economicsCard}>
          <h2 className={styles.chartTitle}>Per-Scooter Economics</h2>
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

            {/* Actual revenue (from data) */}
            {hasRevenue && actualRevPerScooter !== null && (
              <>
                <div className={styles.econDivider} />
                <div className={styles.econItem}>
                  <span className={styles.econLabel}>
                    Revenue / Scooter
                    {config.revenuePerScooter ? ' (actual)' : ''}
                  </span>
                  <span className={styles.econValue} style={{ color: 'var(--color-success)' }}>
                    {formatEUR(actualRevPerScooter)}
                  </span>
                </div>
                <div className={styles.econItem}>
                  <span className={styles.econLabel}>Gross Margin</span>
                  <span
                    className={styles.econValue}
                    style={{ color: actualRevPerScooter - perScooterMonthly >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}
                  >
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

            {/* Estimated revenue (from config, shown only when no real data) */}
            {!hasRevenue && config.revenuePerScooter && (
              <>
                <div className={styles.econDivider} />
                <div className={styles.econItem}>
                  <span className={styles.econLabel}>Revenue / Scooter (est.)</span>
                  <span className={styles.econValue} style={{ color: 'var(--color-success)' }}>
                    {formatEUR(config.revenuePerScooter)}
                  </span>
                </div>
                <div className={styles.econItem}>
                  <span className={styles.econLabel}>Gross Margin (est.)</span>
                  <span className={styles.econValue}
                    style={{ color: config.revenuePerScooter - perScooterMonthly >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                    {formatEUR(config.revenuePerScooter - perScooterMonthly)}
                  </span>
                </div>
                <div className={styles.econItem}>
                  <span className={styles.econLabel}>Margin % (est.)</span>
                  <span className={styles.econValue}>
                    {`${(((config.revenuePerScooter - perScooterMonthly) / config.revenuePerScooter) * 100).toFixed(1)}%`}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
