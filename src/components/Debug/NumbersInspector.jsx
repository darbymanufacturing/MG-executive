import { useState } from 'react';
import { Calculator, X, ChevronDown, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useMetrics } from '../../context/MetricsContext.jsx';
import { formatEUR, formatEURCompact } from '../../utils/formatters.js';
import styles from './NumbersInspector.module.css';

/**
 * Numbers Inspector (W5 / ADR-0024) — a dev-only troubleshooting overlay.
 *
 * Renders `null` unless import.meta.env.DEV AND userRole ∈ {admin, owner}; the dev branch
 * is tree-shaken out of prod builds (import.meta.env.DEV folds to false). It lists every
 * canonical financialSummary field with its formula string + the _inputs provenance, so a
 * Home-vs-Pulse divergence (the #601/#602/#603 class) is visible at a glance. The
 * "Recompute trace" toggle shows month / range / all side-by-side.
 */
function Row({ label, value, formula }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{value}</span>
      {formula && <span className={styles.rowFormula}>{formula}</span>}
    </div>
  );
}

function SummaryBlock({ summary }) {
  const i = summary._inputs;
  return (
    <>
      <div className={styles.sectionTitle}>Costs · period</div>
      <Row
        label="Total (display)"
        value={formatEURCompact(summary.displayTotal)}
        formula={`monthlyCostRate(${formatEUR(summary.monthlyCostRate)}) × ${i.periodMonths} + oneTime(${formatEUR(summary.oneTimeInPeriod)})`}
      />
      <Row label="Monthly run-rate" value={formatEUR(summary.monthlyCostRate)} formula="totalMonthlyCost(periodCosts) · one-time excluded" />
      <Row label="One-time in period" value={formatEUR(summary.oneTimeInPeriod)} formula="Σ one-time amounts dated in period" />
      <Row
        label="Annual"
        value={formatEURCompact(summary.annualTotal)}
        formula={`monthlyCostRate(${formatEUR(summary.monthlyCostRate)}) × 12 (run-rate, NOT totalAnnualCost — #601)`}
      />

      <div className={styles.sectionTitle}>Per-scooter · live count</div>
      <Row
        label="Fleet size (effective)"
        value={summary.fleetSizeEffective}
        formula={summary.liveFleetSize != null ? `live count (${summary.liveFleetSize})` : 'config.fleetSize fallback'}
      />
      <Row label="Cost / scooter / mo" value={formatEUR(summary.perScooterMonthly)} formula={`totalMonthlyCost(costs) / ${summary.fleetSizeEffective}`} />
      <Row label="Cost / scooter / day" value={formatEUR(summary.perScooterDaily)} formula="perScooterMonthly / (365/12)" />
      <Row label="Cost / scooter / yr" value={formatEUR(summary.perScooterAnnual)} formula="perScooterMonthly × 12 (#601-consistent)" />

      <div className={styles.sectionTitle}>Counts</div>
      <Row label="Scooters total" value={summary.scooterCountTotal} />
      <Row label="Scooters active" value={summary.scooterCountActive} formula={`status === '${i.activeStatus}'`} />
      <Row label="Locations" value={summary.locationCount} formula="distinct(config.locations ∪ scooter cities)" />

      <div className={styles.sectionTitle}>Revenue · period</div>
      <Row label="Gross" value={formatEURCompact(summary.revenue.gross)} />
      <Row label="Hopp fee" value={formatEURCompact(summary.revenue.hoppFee)} formula="gross × franchiseRate" />
      <Row label="Company share" value={formatEURCompact(summary.revenue.companyShare)} formula="gross − hoppFee" />
      <Row label="VAT portion" value={formatEURCompact(summary.revenue.vatPortion)} formula="gross × vatRate" />
      <Row label="SIM cost" value={formatEUR(summary.revenue.simCost)} formula={`monthlySimCost × ${i.periodMonths}`} />
      <Row label="Operating revenue" value={formatEURCompact(summary.revenue.operatingRevenue)} formula="companyShare − simCost" />
      <Row label="Annualized revenue" value={formatEURCompact(summary.annualizedRevenue)} formula="trailing-12-mo basis (Investment) — DIFFERENT basis" />
      <Row label="Monthly opex (ex-inv)" value={formatEUR(summary.monthlyOpexExInvestment)} formula="totalMonthlyCost(non-investment)" />
      <Row label="Revenue MTD" value={formatEURCompact(summary.revenueMTD)} formula="current-month gross" />
      <Row label="Costs MTD" value={formatEURCompact(summary.costsMTD)} formula="recurring active + one-time dated, this month (#603)" />

      <div className={styles.sectionTitle}>P&amp;L</div>
      <Row label="Display P&L" value={formatEURCompact(summary.displayPnL)} formula="operatingRevenue − displayTotal" />

      <div className={styles.sectionTitle}>Inputs · provenance</div>
      <Row label="Cost rows" value={i.costCount} />
      <Row label="Period cost rows" value={i.periodCostCount} />
      <Row label="Revenue rows (period)" value={i.revenueRowCount} />
      <Row label="Scooter rows" value={i.scooterCount} />
      <Row label="Period" value={`${i.period.mode}${i.period.monthKey ? ' · ' + i.period.monthKey : ''}${i.period.from ? ' · ' + i.period.from + '→' + i.period.to : ''} (${i.periodMonths} mo)`} />
      <Row label="Franchise fee" value={`${i.financial.applyFranchiseFee ? 'on' : 'off'} · ${(i.financial.franchiseRate * 100).toFixed(0)}% · VAT ${(i.financial.vatRate * 100).toFixed(0)}% · SIM €${i.financial.monthlySimCost}`} />
      <Row label="Computed at" value={i.computedAt} />
    </>
  );
}

export default function NumbersInspector() {
  const { userRole } = useAuth();
  const [open, setOpen] = useState(false);
  const [trace, setTrace] = useState(false);

  // Hard dev + role gate — folds to a constant `false` branch in prod (tree-shaken).
  if (!import.meta.env.DEV) return null;
  if (userRole !== 'admin' && userRole !== 'owner') return null;

  return <InspectorInner open={open} setOpen={setOpen} trace={trace} setTrace={setTrace} />;
}

// Split so useMetrics() only runs once the dev/role gate passed (keeps hook order stable
// inside this always-mounted-under-the-gate inner component).
function InspectorInner({ open, setOpen, trace, setTrace }) {
  const { getSummary, fleetScope } = useMetrics();

  if (!open) {
    return (
      <button
        type="button"
        className={styles.pill}
        onClick={() => setOpen(true)}
        title="Open the Numbers Inspector (dev only)"
      >
        <Calculator size={14} />
        <span>Numbers</span>
      </button>
    );
  }

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthSummary = getSummary({ mode: 'month', monthKey, months: 1 });
  const allSummary = getSummary({ mode: 'all', months: 1 });

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <Calculator size={14} className={styles.headerIcon} />
        <span className={styles.headerTitle}>Numbers Inspector</span>
        <span className={styles.scopeBadge}>{fleetScope.label}</span>
        <button type="button" className={styles.closeBtn} onClick={() => setOpen(false)} aria-label="Close inspector">
          <X size={14} />
        </button>
      </div>

      <button type="button" className={styles.traceToggle} onClick={() => setTrace((t) => !t)}>
        {trace ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        Recompute trace (month vs all)
      </button>

      <div className={styles.body}>
        {trace ? (
          <div className={styles.traceGrid}>
            <div className={styles.traceCol}>
              <div className={styles.traceHead}>This month ({monthKey})</div>
              <SummaryBlock summary={monthSummary} />
            </div>
            <div className={styles.traceCol}>
              <div className={styles.traceHead}>All time</div>
              <SummaryBlock summary={allSummary} />
            </div>
          </div>
        ) : (
          <SummaryBlock summary={monthSummary} />
        )}
      </div>
    </div>
  );
}
