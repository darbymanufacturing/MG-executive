import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Euro, Bike, TrendingUp, ListChecks, Target, DollarSign, Plus,
  TrendingDown, Activity, Users,
} from 'lucide-react';
import Header from '../components/Layout/Header.jsx';
import KpiCard from '../components/Dashboard/KpiCard.jsx';
import CostBreakdownChart from '../components/Dashboard/CostBreakdownChart.jsx';
import MonthlyCostTrend from '../components/Dashboard/MonthlyCostTrend.jsx';
import RevenueCostTrend from '../components/Dashboard/RevenueCostTrend.jsx';
import Button from '../components/Shared/Button.jsx';
import { useCosts } from '../context/CostContext.jsx';
import { useRevenue } from '../context/RevenueContext.jsx';
import {
  totalMonthlyCost, totalAnnualCost,
  costPerScooterMonthly, costPerScooterDaily, costPerScooterAnnual,
  breakdownByCategory, monthlyTrendData, budgetVariance,
} from '../utils/calculations.js';
import {
  totalRevenue, currentMonthRevenue, avgTripsPerDay, revenuePerTrip,
  vehicleUtilization, combinedMonthlyTrend, actualRevenuePerScooterMonthly,
} from '../utils/revenueCalculations.js';
import { formatEUR, formatEURCompact, formatPercent, formatTrips } from '../utils/formatters.js';
import styles from './Dashboard.module.css';

const PERIODS = ['Monthly', 'Quarterly', 'Annual'];

export default function Dashboard() {
  const { costs, config, loadSampleData } = useCosts();
  const { revenueData } = useRevenue();
  const navigate = useNavigate();
  const [period, setPeriod] = useState('Monthly');

  const multiplier = period === 'Monthly' ? 1 : period === 'Quarterly' ? 3 : 12;
  const hasRevenue = revenueData.length > 0;

  // ── Cost metrics ─────────────────────────────────────────────────────────
  const monthlyTotal       = totalMonthlyCost(costs);
  const annualTotal        = totalAnnualCost(costs);
  const perScooterMonthly  = costPerScooterMonthly(costs, config.fleetSize);
  const perScooterDaily    = costPerScooterDaily(costs, config.fleetSize);
  const perScooterAnnual   = costPerScooterAnnual(costs, config.fleetSize);
  const breakdown          = breakdownByCategory(costs);
  const trendData          = monthlyTrendData(costs);
  const budgetVar          = budgetVariance(perScooterMonthly, config.targetCostPerScooter);
  const displayTotal       = period === 'Annual' ? annualTotal : monthlyTotal * multiplier;
  const displayPerScooter  = period === 'Annual' ? perScooterAnnual : perScooterMonthly * multiplier;

  // ── Revenue metrics ───────────────────────────────────────────────────────
  const monthlyRevenue     = currentMonthRevenue(revenueData);
  const displayRevenue     = period === 'Annual'
    ? totalRevenue(revenueData)
    : period === 'Quarterly' ? monthlyRevenue * 3 : monthlyRevenue;
  const displayPnL         = displayRevenue - displayTotal;
  const tripsPerDay        = avgTripsPerDay(revenueData);
  const revPerTrip         = revenuePerTrip(revenueData);
  const utilization        = vehicleUtilization(revenueData, config.fleetSize);
  const actualRevPerScooter= actualRevenuePerScooterMonthly(revenueData, config.fleetSize);
  const combinedTrend      = hasRevenue ? combinedMonthlyTrend(trendData, revenueData) : null;

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
            value={costs.length}
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
              sub={`${formatEURCompact(totalRevenue(revenueData))} all time`}
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
