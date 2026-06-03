import { useCosts } from '../../context/CostContext.jsx';
import { useRevenue } from '../../context/RevenueContext.jsx';
import { useMaintenance } from '../../context/MaintenanceContext.jsx';
import { useFleet } from '../../context/FleetContext.jsx';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
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

  const revenueData = revenueCtx?.revenueData || [];

  /* Current month key e.g. "2026-05" */
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  /* Revenue MTD: sum totalPaidRevenue for rows in current month */
  const revenueMTD = revenueData
    .filter(r => r.date?.startsWith(monthKey))
    .reduce((s, r) => s + (r.totalPaidRevenue || 0), 0);

  /* Costs MTD: sum amounts where startDate is in current month */
  const costsMTD = (costs || [])
    .filter(c => c.startDate?.startsWith(monthKey))
    .reduce((s, c) => s + (c.amount || 0), 0);

  /* Active fleet: live count of scooters with status === 'Active' from MaintenanceContext.
   * For the denominator, prefer the fleet-scoped total scooter count when FleetContext
   * is available; fall back to config.fleetSize (manual scalar) when it is not. */
  const activeScooterCount = maintenanceCtx?.scooters?.filter(s => s.status === 'Active').length;
  const liveTotalFleet = (() => {
    if (!fleetCtx || !maintenanceCtx?.scooters || !maintenanceCtx.scooters.length) return null;
    if (fleetCtx.isAllFleets) return maintenanceCtx.scooters.length;
    return fleetCtx.scopeByFleet(maintenanceCtx.scooters).length || null;
  })();
  const totalFleet = liveTotalFleet ?? config?.fleetSize;
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
      value: revenueMTD > 0
        ? `${Math.round(((revenueMTD - costsMTD) / revenueMTD) * 100)}%`
        : '—',
      trend: revenueMTD > costsMTD ? 'up' : revenueMTD > 0 ? 'down' : 'flat',
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
      <div className="eyebrow" style={{ marginBottom: 12 }}>Today's Pulse</div>
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
