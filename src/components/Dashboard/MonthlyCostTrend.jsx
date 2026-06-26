import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { COST_GROUPS, COST_GROUP_KEYS } from '../../utils/constants.js';
import { formatEURCompact, formatEUR } from '../../utils/formatters.js';
import styles from './Chart.module.css';

// Trend data is bucketed by financial group (fixed/variable/investment/debt/transfer)
// so every one of the ~43 categories is represented without 43 illegible stacked bars.
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipLabel}>{label}</div>
      {payload.filter((p) => p.value > 0).map((p) => (
        <div key={p.dataKey} className={styles.tooltipRow}>
          <span style={{ color: p.fill }}>{COST_GROUPS[p.dataKey]?.label || p.dataKey}</span>
          <span>{formatEUR(p.value)}</span>
        </div>
      ))}
      <div className={styles.tooltipTotal}>Total: {formatEUR(total)}</div>
    </div>
  );
}

export default function MonthlyCostTrend({ data }) {
  const angled = data.length > 7;
  return (
    <div className={styles.chartWrap}>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: angled ? 20 : 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fill: '#888', fontSize: 11, ...(angled ? { angle: -35, textAnchor: 'end' } : {}) }}
            axisLine={false}
            tickLine={false}
            height={angled ? 50 : 30}
          />
          <YAxis tickFormatter={formatEURCompact} tick={{ fill: '#888', fontSize: 11 }} axisLine={false} tickLine={false} width={56} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Legend
            formatter={(value) => (
              <span style={{ color: '#ccc', fontSize: 12 }}>{COST_GROUPS[value]?.label || value}</span>
            )}
          />
          {COST_GROUP_KEYS.map((g, i) => (
            <Bar
              key={g}
              isAnimationActive={false}
              dataKey={g}
              stackId="a"
              fill={COST_GROUPS[g].color}
              radius={i === COST_GROUP_KEYS.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
