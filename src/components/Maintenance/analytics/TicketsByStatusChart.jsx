import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const STATUS_COLORS = {
  Active: '#0ea5e9',
  Backlog: '#888888',
  Investigation: '#FF9800',
  Blocked: '#F44336',
  'To be Repainted': '#A0521D',
  Donor: '#8E24AA',
  Completed: '#4CAF50',
};

const ARCHIVED_STATUSES = ['Completed', 'Donor'];

function buildData(tickets) {
  const counts = {};
  tickets
    .filter((t) => !ARCHIVED_STATUSES.includes(t.status))
    .forEach((t) => {
      const s = t.status || 'Unknown';
      counts[s] = (counts[s] || 0) + 1;
    });
  return Object.entries(counts).map(([name, value]) => ({ name, value }));
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0].payload;
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
      <strong>{name}</strong>: {value} ticket{value !== 1 ? 's' : ''}
    </div>
  );
};

export default function TicketsByStatusChart({ tickets }) {
  if (!tickets || tickets.length === 0) {
    return (
      <div style={{
        height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#888', fontFamily: 'Inter, sans-serif', fontSize: 14,
      }}>
        No ticket data available
      </div>
    );
  }

  const data = buildData(tickets);

  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="45%"
          innerRadius={50}
          outerRadius={90}
          paddingAngle={2}
          dataKey="value"
        >
          {data.map((entry) => (
            <Cell
              key={entry.name}
              fill={STATUS_COLORS[entry.name] || '#555'}
            />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        <Legend
          iconType="circle"
          iconSize={10}
          wrapperStyle={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#CCC' }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
