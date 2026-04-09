import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { CATEGORIES, CHART_COLORS } from '../../utils/constants.js';
import { formatEURCompact, formatEUR } from '../../utils/formatters.js';
import styles from './Chart.module.css';

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipLabel}>{label}</div>
      {payload.filter((p) => p.value > 0).map((p) => (
        <div key={p.dataKey} className={styles.tooltipRow}>
          <span style={{ color: p.fill }}>{CATEGORIES[p.dataKey]?.label}</span>
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
              <span style={{ color: '#ccc', fontSize: 12 }}>{CATEGORIES[value]?.label || value}</span>
            )}
          />
          <Bar dataKey="one-off"     stackId="a" fill={CHART_COLORS['one-off']}     radius={[0,0,0,0]} />
          <Bar dataKey="investment"  stackId="a" fill={CHART_COLORS['investment']}  radius={[0,0,0,0]} />
          <Bar dataKey="variable"    stackId="a" fill={CHART_COLORS['variable']}    radius={[0,0,0,0]} />
          <Bar dataKey="loan"        stackId="a" fill={CHART_COLORS['loan']}        radius={[0,0,0,0]} />
          <Bar dataKey="credit-card" stackId="a" fill={CHART_COLORS['credit-card']} radius={[0,0,0,0]} />
          <Bar dataKey="fixed"       stackId="a" fill={CHART_COLORS['fixed']}       radius={[4,4,0,0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
