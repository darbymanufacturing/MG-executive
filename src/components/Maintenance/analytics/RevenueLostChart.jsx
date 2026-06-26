import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

// Mirror MaintenanceContext TERMINAL_STATUSES — tickets in these states have
// stopped accruing revenue loss and must be excluded from the chart, matching
// the totalRevenueLost KPI (!TERMINAL_STATUSES denylist). Bug #642: the old
// OPEN_STATUSES allowlist omitted 'To be Repainted' and any future non-terminal
// statuses, causing chart/KPI divergence.
const TERMINAL_STATUSES = new Set(['Completed', 'Donor']);

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function buildData(tickets) {
  const map = {};

  tickets
    .filter((t) => !TERMINAL_STATUSES.has(t.status) && t.dateEntered)
    .forEach((t) => {
      const d = new Date(t.dateEntered + 'T12:00:00');
      if (isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`;
      if (!map[key]) map[key] = { key, label, revenueLost: 0 };
      map[key].revenueLost += t.revenueLost || 0;
    });

  return Object.values(map).sort((a, b) => a.key.localeCompare(b.key));
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#1a1a1a',
      border: '1px solid #2a2a2a',
      borderRadius: 6,
      padding: '8px 12px',
      fontFamily: 'Inter, sans-serif',
      fontSize: 13,
      color: '#fff',
    }}>
      <div style={{ color: '#888', marginBottom: 4 }}>{label}</div>
      <strong>€{Number(payload[0].value).toFixed(2)}</strong>
    </div>
  );
};

export default function RevenueLostChart({ tickets }) {
  if (!tickets || tickets.length === 0) {
    return (
      <div style={{
        height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#888', fontFamily: 'Inter, sans-serif', fontSize: 14,
      }}>
        No ticket data available
      </div>
    );
  }

  const data = buildData(tickets);

  if (data.length === 0) {
    return (
      <div style={{
        height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#888', fontFamily: 'Inter, sans-serif', fontSize: 14,
      }}>
        No open tickets with revenue loss data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
        <defs>
          <linearGradient id="revGradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.8} />
            <stop offset="100%" stopColor="#10b981" stopOpacity={0.8} />
          </linearGradient>
          <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
        <XAxis
          dataKey="label"
          tick={{ fill: '#888', fontSize: 11, fontFamily: 'Inter, sans-serif' }}
          axisLine={{ stroke: '#2a2a2a' }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: '#888', fontSize: 11, fontFamily: 'Inter, sans-serif' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `€${v}`}
        />
        <Tooltip content={<CustomTooltip />} />
        <Area isAnimationActive={false}
          type="monotone"
          dataKey="revenueLost"
          stroke="url(#revGradient)"
          strokeWidth={2}
          fill="url(#revFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
