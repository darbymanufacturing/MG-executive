import {
  ComposedChart, Bar, Line, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { CHART_COLORS, REVENUE_CHART_COLORS } from '../../utils/constants.js';
import { formatEURCompact, formatEUR } from '../../utils/formatters.js';
import styles from './Chart.module.css';

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const rev      = payload.find((p) => p.dataKey === 'revenue');
  const profit   = payload.find((p) => p.dataKey === 'profit');
  const fcastRev = payload.find((p) => p.dataKey === 'forecastRevenue');
  const fcastCst = payload.find((p) => p.dataKey === 'forecastCost');
  const costs    = payload.filter((p) => ['fixed','variable','one-off','investment','loan','credit-card'].includes(p.dataKey));
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
      {fcastRev && fcastRev.value !== null && (
        <div className={styles.tooltipRow} style={{ borderTop: '1px solid #333', marginTop: 4, paddingTop: 4 }}>
          <span style={{ color: '#7dd3fc' }}>▸ Forecast Revenue</span>
          <span>{formatEUR(fcastRev.value)}</span>
        </div>
      )}
      {fcastCst && fcastCst.value !== null && (
        <div className={styles.tooltipRow}>
          <span style={{ color: '#f9a8d4' }}>▸ Forecast Costs</span>
          <span>{formatEUR(fcastCst.value)}</span>
        </div>
      )}
    </div>
  );
}

export default function RevenueCostTrend({ data, showForecast = false }) {
  const angled = data.length > 7;
  return (
    <div className={styles.chartWrap}>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: angled ? 20 : 0 }}>
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
            formatter={(value) => {
              const labels = {
                'one-off': 'One-Off', fixed: 'Fixed', variable: 'Variable',
                investment: 'Investment', loan: 'Loan', 'credit-card': 'Credit Card',
                revenue: 'Revenue', profit: 'Net Profit/Loss',
              };
              return <span style={{ color: '#ccc', fontSize: 12 }}>{labels[value] || value}</span>;
            }}
          />
          {/* Stacked cost bars */}
          <Bar isAnimationActive={false} dataKey="one-off"     stackId="costs" fill={CHART_COLORS['one-off']}     name="One-Off"     radius={[0,0,0,0]} />
          <Bar isAnimationActive={false} dataKey="investment"  stackId="costs" fill={CHART_COLORS['investment']}  name="Investment"  radius={[0,0,0,0]} />
          <Bar isAnimationActive={false} dataKey="variable"    stackId="costs" fill={CHART_COLORS['variable']}    name="Variable"    radius={[0,0,0,0]} />
          <Bar isAnimationActive={false} dataKey="loan"        stackId="costs" fill={CHART_COLORS['loan']}        name="Loan"        radius={[0,0,0,0]} />
          <Bar isAnimationActive={false} dataKey="credit-card" stackId="costs" fill={CHART_COLORS['credit-card']} name="Credit Card" radius={[0,0,0,0]} />
          <Bar isAnimationActive={false} dataKey="fixed"       stackId="costs" fill={CHART_COLORS['fixed']}       name="Fixed"       radius={[4,4,0,0]} />
          {/* Revenue line */}
          <Line isAnimationActive={false}
            type="monotone"
            dataKey="revenue"
            stroke={REVENUE_CHART_COLORS.revenue}
            strokeWidth={2.5}
            dot={{ fill: REVENUE_CHART_COLORS.revenue, r: 3 }}
            activeDot={{ r: 5 }}
            name="Revenue"
          />
          {/* Profit/loss area */}
          <Area isAnimationActive={false}
            type="monotone"
            dataKey="profit"
            stroke="none"
            fill={REVENUE_CHART_COLORS.profit}
            fillOpacity={0.15}
            name="Net Profit/Loss"
          />
          {/* Forecast dashed lines (only when showForecast=true) */}
          {showForecast && (
            <Line isAnimationActive={false}
              type="monotone"
              dataKey="forecastRevenue"
              stroke="#7dd3fc"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              name="Forecast Revenue"
              connectNulls
            />
          )}
          {showForecast && (
            <Line isAnimationActive={false}
              type="monotone"
              dataKey="forecastCost"
              stroke="#f9a8d4"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              name="Forecast Costs"
              connectNulls
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
