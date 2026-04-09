import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';

function truncate(str, n) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function buildData(parts) {
  return parts
    .map((p) => ({
      name: truncate(p.partName, 12),
      fullName: p.partName,
      value: (p.unitCost || 0) * (p.stockOnHand || 0),
    }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 15);
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const { fullName, value } = payload[0].payload;
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
      <div style={{ color: '#CCC', marginBottom: 4 }}>{fullName}</div>
      <strong>€{Number(value).toFixed(2)}</strong>
    </div>
  );
};

export default function InventoryValueChart() {
  const { parts } = useMaintenance();

  if (!parts || parts.length === 0) {
    return (
      <div style={{
        height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#888', fontFamily: 'Inter, sans-serif', fontSize: 14,
      }}>
        No parts data available
      </div>
    );
  }

  const data = buildData(parts);

  if (data.length === 0) {
    return (
      <div style={{
        height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#888', fontFamily: 'Inter, sans-serif', fontSize: 14,
      }}>
        No parts with inventory value
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 48, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fill: '#888', fontSize: 11, fontFamily: 'Inter, sans-serif' }}
          axisLine={{ stroke: '#2a2a2a' }}
          tickLine={false}
          angle={-35}
          textAnchor="end"
          interval={0}
        />
        <YAxis
          tick={{ fill: '#888', fontSize: 11, fontFamily: 'Inter, sans-serif' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `€${v}`}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
