import {
  ComposedChart, Bar, Line, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { CHART_COLORS, REVENUE_CHART_COLORS } from '../../utils/constants.js';
import { formatEURCompact, formatEUR } from '../../utils/formatters.js';
import styles from './Chart.module.css';

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const rev    = payload.find((p) => p.dataKey === 'revenue');
  const profit = payload.find((p) => p.dataKey === 'profit');
  const costs  = payload.filter((p) => ['fixed','variable','one-off','investment'].includes(p.dataKey));
  const totalCost = costs.reduce((s, p) => s + (p.value || 0), 0);

  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipLabel}>{label}</div>
      {rev && (
        <div className={styles.tooltipRow}>
          <span style={{ color: REVENUE_CHART_COLORS.revenue }}>Revenue</span>
          <span>{formatEUR(rev.value)}</span>
        </div>
      )}
      {costs.filter((p) => p.value > 0).map((p) => (
        <div key={p.dataKey} className={styles.tooltipRow}>
          <span style={{ color: p.fill }}>{p.name}</span>
          <span>{formatEUR(p.value)}</span>
        </div>
      ))}
      <div className={styles.tooltipRow}>
        <span style={{ color: '#aaa' }}>Total Costs</span>
        <span>{formatEUR(totalCost)}</span>
      </div>
      {profit && (
        <div className={`${styles.tooltipTotal}`} style={{ color: profit.value >= 0 ? REVENUE_CHART_COLORS.profit : REVENUE_CHART_COLORS.loss }}>
          {profit.value >= 0 ? '▲ Profit' : '▼ Loss'}: {formatEUR(Math.abs(profit.value))}
        </div>
      )}
    </div>
  );
}

export default function RevenueCostTrend({ data }) {
  return (
    <div className={styles.chartWrap}>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
          <XAxis dataKey="month" tick={{ fill: '#888', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={formatEURCompact} tick={{ fill: '#888', fontSize: 11 }} axisLine={false} tickLine={false} width={56} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Legend
            formatter={(value) => {
              const labels = {
                'one-off': 'One-Off', fixed: 'Fixed', variable: 'Variable',
                investment: 'Investment', revenue: 'Revenue', profit: 'Net Profit/Loss',
              };
              return <span style={{ color: '#ccc', fontSize: 12 }}>{labels[value] || value}</span>;
            }}
          />
          {/* Stacked cost bars */}
          <Bar dataKey="one-off"    stackId="costs" fill={CHART_COLORS['one-off']}   name="One-Off"    radius={[0,0,0,0]} />
          <Bar dataKey="investment" stackId="costs" fill={CHART_COLORS['investment']} name="Investment" radius={[0,0,0,0]} />
          <Bar dataKey="variable"   stackId="costs" fill={CHART_COLORS['variable']}   name="Variable"   radius={[0,0,0,0]} />
          <Bar dataKey="fixed"      stackId="costs" fill={CHART_COLORS['fixed']}      name="Fixed"      radius={[4,4,0,0]} />
          {/* Revenue line */}
          <Line
            type="monotone"
            dataKey="revenue"
            stroke={REVENUE_CHART_COLORS.revenue}
            strokeWidth={2.5}
            dot={{ fill: REVENUE_CHART_COLORS.revenue, r: 3 }}
            activeDot={{ r: 5 }}
            name="Revenue"
          />
          {/* Profit/loss area */}
          <Area
            type="monotone"
            dataKey="profit"
            stroke="none"
            fill={REVENUE_CHART_COLORS.profit}
            fillOpacity={0.15}
            name="Net Profit/Loss"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
