import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

const ARCHIVED_STATUSES = ['Completed', 'Donor'];

function buildData(tickets) {
  const counts = {};
  tickets
    .filter((t) => !ARCHIVED_STATUSES.includes(t.status))
    .forEach((t) => {
    const tags = t.primaryTag
      ? t.primaryTag.split(',').map((s) => s.trim())
      : ['Untagged'];
    tags.forEach((tag) => {
      counts[tag] = (counts[tag] || 0) + 1;
    });
  });
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const { name, count } = payload[0].payload;
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
      <strong>{name}</strong>: {count} ticket{count !== 1 ? 's' : ''}
    </div>
  );
};

export default function TicketsByTagChart({ tickets }) {
  if (!tickets || tickets.length === 0) {
    return (
      <div style={{
        height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#888', fontFamily: 'Inter, sans-serif', fontSize: 14,
      }}>
        No ticket data available
      </div>
    );
  }

  const data = buildData(tickets);

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart
        layout="vertical"
        data={data}
        margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: '#888', fontSize: 12, fontFamily: 'Inter, sans-serif' }}
          axisLine={{ stroke: '#2a2a2a' }}
          tickLine={false}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={110}
          tick={{ fill: '#CCC', fontSize: 12, fontFamily: 'Inter, sans-serif' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Bar isAnimationActive={false} dataKey="count" fill="#0ea5e9" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
