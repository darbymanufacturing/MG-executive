import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { CATEGORIES, CHART_COLORS } from '../../utils/constants.js';
import { formatEUR } from '../../utils/formatters.js';
import styles from './Chart.module.css';

const RADIAN = Math.PI / 180;

function CustomLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  if (percent < 0.06) return null;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0];
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipLabel}>{CATEGORIES[name]?.fullLabel || name}</div>
      <div className={styles.tooltipValue}>{formatEUR(value)}</div>
    </div>
  );
}

export default function CostBreakdownChart({ breakdown }) {
  const data = Object.entries(breakdown)
    .filter(([, v]) => v > 0)
    .map(([key, value]) => ({ name: key, value }));

  if (data.length === 0) {
    return <div className={styles.empty}>No cost data to display</div>;
  }

  return (
    <div className={styles.chartWrap}>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={3}
            dataKey="value"
            labelLine={false}
            label={CustomLabel}
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={CHART_COLORS[entry.name]} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            formatter={(value) => (
              <span style={{ color: '#ccc', fontSize: 12 }}>
                {CATEGORIES[value]?.fullLabel || value}
              </span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
