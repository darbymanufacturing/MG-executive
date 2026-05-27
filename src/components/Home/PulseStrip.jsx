import { useCosts } from '../../context/CostContext.jsx';
import { useRevenue } from '../../context/RevenueContext.jsx';
import { useMaintenance } from '../../context/MaintenanceContext.jsx';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import styles from './PulseStrip.module.css';

function MiniSparkline({ data = [], color = 'var(--accent)' }) {
  if (!data.length) return null;
  const w = 100, h = 28;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / span) * (h - 4) - 2}`)
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

export default function PulseStrip() {
  const { costs } = useCosts();
  const revenueCtx = useRevenueSafe();
  const maintenanceCtx = useMaintenanceSafe();

  /* Costs MTD */
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const costsMTD = costs?.filter(c => c.date?.startsWith(monthKey)).reduce((s, c) => s + (c.amount || 0), 0) || 0;

  /* Revenue MTD (best effort) */
  const revenueMTD = revenueCtx?.totalRevenue || 0;

  /* Open tickets */
  const openTickets = maintenanceCtx?.tickets?.filter(t => t.status !== 'Completed' && t.status !== 'Donor').length || 0;

  const tiles = [
    { label: 'Revenue MTD',  value: fmtEur(revenueMTD), trend: 'up',   sparkline: [12,14,15,13,17,18,20,22,21,24,25,28] },
    { label: 'Costs MTD',    value: fmtEur(costsMTD),   trend: 'flat',  sparkline: [16,18,15,14,12,13,12,10,11,12,11,10] },
    { label: 'Net margin',   value: revenueMTD > 0 ? `${Math.round(((revenueMTD - costsMTD) / revenueMTD) * 100)}%` : '—', trend: 'up', sparkline: [30,32,28,34,36,38,35,38,40,38,41,42] },
    { label: 'Open tickets', value: String(openTickets), trend: openTickets > 10 ? 'down' : 'up', sparkline: [30,28,27,29,26,25,24,23,25,24,23,openTickets] },
    { label: 'Active fleet', value: '184',              trend: 'flat',  sparkline: [180,182,181,184,183,185,184,186,184,183,184,184] },
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
