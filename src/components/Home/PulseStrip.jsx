import { useCosts } from '../../context/CostContext.jsx';
import { useRevenue } from '../../context/RevenueContext.jsx';
import { useMaintenance } from '../../context/MaintenanceContext.jsx';
import { useFleet } from '../../context/FleetContext.jsx';
import { useMetrics } from '../../context/MetricsContext.jsx';
import { Link } from 'react-router-dom';
import { ArrowUp, ArrowDown, Minus, ArrowRight } from 'lucide-react';
import { normalizeToMonthly } from '../../utils/calculations.js';
import styles from './PulseStrip.module.css';

function MiniSparkline({ data = [], color = 'var(--accent)' }) {
  if (!data.length) return null;
  const w = 100, h = 28;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  // BUG #178: guard data.length <= 1 to avoid division by zero → NaN coords
  const pts = data
    .map((v, i) => {
      const x = data.length <= 1 ? 0 : (i / (data.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: h, overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function KPITile({ label, value, delta, trend, sparkline }) {
  const tColor = trend === 'up' ? 'var(--status-green)' : trend === 'down' ? 'var(--status-red)' : 'var(--fg-muted)';
  const Arrow = trend === 'up' ? ArrowUp : trend === 'down' ? ArrowDown : Minus;

  return (
    <div className={`card ${styles.tile}`}>
      <div className={styles.tileTop}>
        <span className={styles.tileLabel}>{label}</span>
        {delta && (
          <span className={styles.tileDelta} style={{ color: tColor }}>
            <Arrow size={11} />{delta}
          </span>
        )}
      </div>
      <div className={`num ${styles.tileValue}`}>{value}</div>
      {sparkline && (
        <MiniSparkline data={sparkline} color={trend === 'down' ? 'var(--status-red)' : 'var(--accent)'} />
      )}
    </div>
  );
}

function fmtEur(val) {
  if (!val && val !== 0) return '—';
  if (Math.abs(val) >= 1000) return `€${(val / 1000).toFixed(1)}k`;
  return `€${Math.round(val)}`;
}

/** Build a 7-day daily revenue sparkline (oldest → newest). */
function buildRevenueSparkline(revenueData) {
  const days = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
  }
  return days.map(day =>
    revenueData
      .filter(r => r.date === day)
      .reduce((s, r) => s + (r.totalPaidRevenue || 0), 0)
  );
}

/** Derive trend from last 3 days vs prior 3 days of the sparkline. */
function deriveTrend(sparkline) {
  if (!sparkline || sparkline.length < 6) return 'flat';
  const recent = sparkline.slice(-3).reduce((a, b) => a + b, 0);
  const prior  = sparkline.slice(-6, -3).reduce((a, b) => a + b, 0);
  if (recent > prior * 1.03) return 'up';
  if (recent < prior * 0.97) return 'down';
  return 'flat';
}

export default function PulseStrip() {
  const { costs, config } = useCosts();
  const revenueCtx = useRevenueSafe();
  const maintenanceCtx = useMaintenanceSafe();
  const fleetCtx = useFleetSafe();
  const metricsCtx = useMetricsSafe();

  const revenueData = revenueCtx?.revenueData || [];
  const now = new Date();

  /* W5/ADR-0024 — the numbers hub owns Revenue MTD, Costs MTD (#603 basis), and the
   * live active/total fleet counts. PulseStrip READS them from useMetrics().mtd. The
   * inline fallbacks below run ONLY when the hub is unavailable (e.g. unit tests that
   * render PulseStrip without a MetricsProvider) so the component degrades gracefully. */
  const mtd = metricsCtx?.mtd ?? null;

  /* Revenue MTD: sum totalPaidRevenue for rows in current month (gross) */
  const revenueMTD = mtd
    ? mtd.revenueMTD
    : (() => {
        const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        return revenueData
          .filter(r => r.date?.startsWith(monthKey))
          .reduce((s, r) => s + (r.totalPaidRevenue || 0), 0);
      })();

  /* #617 — operatingRevenueMTD: net MTD revenue after Hopp franchise fee (19%) and SIM
   * deduction (€150/mo). This is the correct denominator for the Net Margin tile.
   * When the hub is available, mtd.revenue.operatingRevenue is already computed by
   * revenueBreakdown(mtdPeriodRevenue, financial, 1) in financialSummary.js:161.
   * Fallback applies the same formula inline using FIN_DEFAULTS. */
  const operatingRevenueMTD = mtd
    ? mtd.revenue.operatingRevenue
    : revenueMTD * (1 - 0.19) - 150;

  /* Costs MTD (#603): recurring costs ACTIVE this month at their monthly-normalized rate
   * + one-time costs DATED this month — the same basis as the Pulse page's monthly Total
   * Cost. (The pre-hub inline filter dropped recurring costs that started earlier, showing
   * €2.3K here vs €4.0K there.) Fallback mirrors the hub's costsMTD when no provider. */
  const costsMTD = mtd
    ? mtd.costsMTD
    : (() => {
        const mtdY = now.getFullYear();
        const mtdMonthIdx = now.getMonth();
        const mtdMonthStart = new Date(mtdY, mtdMonthIdx, 1);
        const mtdMonthEnd = new Date(mtdY, mtdMonthIdx + 1, 0);
        return (costs || []).reduce((s, c) => {
          const start = c.startDate ? new Date(c.startDate) : null;
          const end = c.endDate ? new Date(c.endDate) : null;
          if (c.frequency === 'one-time') {
            return (start && start.getFullYear() === mtdY && start.getMonth() === mtdMonthIdx)
              ? s + (c.amount || 0)
              : s;
          }
          const activeThisMonth = (start ? start <= mtdMonthEnd : true) && (end ? end >= mtdMonthStart : true);
          return activeThisMonth ? s + normalizeToMonthly(c) : s;
        }, 0);
      })();

  /* Active fleet: live count of scooters with status === 'Active'. The denominator is the
   * fleet-scoped total scooter count (from the hub when available; otherwise the legacy
   * FleetContext-or-config fallback). */
  const activeScooterCount = mtd
    ? mtd.scooterCountActive
    : maintenanceCtx?.scooters?.filter(s => s.status === 'Active').length;
  const totalFleet = mtd
    ? mtd.fleetSizeEffective
    : (() => {
        const liveTotalFleet = (() => {
          if (!fleetCtx || !maintenanceCtx?.scooters || !maintenanceCtx.scooters.length) return null;
          if (fleetCtx.isAllFleets) return maintenanceCtx.scooters.length;
          return fleetCtx.scopeByFleet(maintenanceCtx.scooters).length || null;
        })();
        return liveTotalFleet ?? config?.fleetSize;
      })();
  const activeFleet = activeScooterCount != null
    ? (totalFleet != null ? `${activeScooterCount} / ${totalFleet}` : String(activeScooterCount))
    : '—';

  /* Open tickets */
  const openTickets = maintenanceCtx?.tickets?.filter(
    t => t.status !== 'Completed' && t.status !== 'Donor'
  ).length || 0;

  /* 7-day revenue sparkline + trend */
  const revenueSparkline = buildRevenueSparkline(revenueData);
  const revenueTrend = deriveTrend(revenueSparkline);

  const tiles = [
    {
      label: 'Revenue MTD',
      value: fmtEur(revenueMTD),
      trend: revenueTrend,
      sparkline: revenueSparkline,
    },
    {
      label: 'Costs MTD',
      value: fmtEur(costsMTD),
      trend: 'flat',
      sparkline: null,
    },
    {
      label: 'Net margin',
      // #617 — divide by operatingRevenueMTD (net after Hopp fee + SIM), not gross revenueMTD.
      value: operatingRevenueMTD > 0
        ? `${Math.round(((operatingRevenueMTD - costsMTD) / operatingRevenueMTD) * 100)}%`
        : '—',
      trend: operatingRevenueMTD > costsMTD ? 'up' : operatingRevenueMTD > 0 ? 'down' : 'flat',
      sparkline: null,
    },
    {
      label: 'Open tickets',
      value: String(openTickets),
      trend: openTickets > 10 ? 'down' : 'up',
      sparkline: null,
    },
    {
      label: 'Active fleet',
      value: String(activeFleet),
      trend: 'flat',
      sparkline: null,
    },
  ];

  return (
    <div className={styles.pulseSection}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
        <div className="eyebrow">Today's Pulse</div>
        <Link
          to="/money"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.8125rem', fontWeight: 500, color: 'var(--accent)', textDecoration: 'none' }}
        >
          Money overview <ArrowRight size={13} />
        </Link>
      </div>
      <div className={styles.grid}>
        {tiles.map((t, i) => <KPITile key={i} {...t} />)}
      </div>
    </div>
  );
}

function useRevenueSafe() {
  try { return useRevenue(); } catch { return null; }
}
function useMaintenanceSafe() {
  try { return useMaintenance(); } catch { return null; }
}
function useFleetSafe() {
  try { return useFleet(); } catch { return null; }
}
function useMetricsSafe() {
  try { return useMetrics(); } catch { return null; }
}
