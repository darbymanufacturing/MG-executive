import {
  ComposedChart, Bar, Line, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Cell,
} from 'recharts';
import { REVENUE_CHART_COLORS } from '../../utils/constants.js';
import { formatEUR, formatEURCompact } from '../../utils/formatters.js';
import styles from './Chart.module.css';

const COLOR_REVENUE  = REVENUE_CHART_COLORS.revenue;  // #4CAF50
const COLOR_PROFIT   = '#66BB6A';
const COLOR_LOSS     = '#F44336';
const COLOR_COST     = '#C97D49';
const COLOR_NO_DATA  = '#2a2a2a';

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const rev    = payload.find((p) => p.dataKey === 'revenue');
  const profit = payload.find((p) => p.dataKey === 'profit');
  const trips  = payload.find((p) => p.dataKey === 'trips');
  const entry  = payload[0]?.payload;

  if (!entry?.hasData && !entry?.revenue) {
    return (
      <div className={styles.tooltip}>
        <div className={styles.tooltipLabel}>{label}</div>
        <div className={styles.tooltipRow}>
          <span style={{ color: '#666' }}>No revenue data</span>
        </div>
        <div className={styles.tooltipRow}>
          <span style={{ color: COLOR_COST }}>Daily cost rate</span>
          <span>{formatEUR(entry?.costRate ?? 0)}</span>
        </div>
      </div>
    );
  }

  const profitVal = profit?.value ?? 0;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipLabel}>{label}</div>
      {rev && (
        <div className={styles.tooltipRow}>
          <span style={{ color: COLOR_REVENUE }}>Revenue</span>
          <span>{formatEUR(rev.value)}</span>
        </div>
      )}
      <div className={styles.tooltipRow}>
        <span style={{ color: COLOR_COST }}>Daily cost rate</span>
        <span>{formatEUR(entry?.costRate ?? 0)}</span>
      </div>
      {trips && trips.value > 0 && (
        <div className={styles.tooltipRow}>
          <span style={{ color: '#42A5F5' }}>Trips</span>
          <span>{trips.value}</span>
        </div>
      )}
      {profit && (
        <div
          className={styles.tooltipTotal}
          style={{ color: profitVal >= 0 ? COLOR_PROFIT : COLOR_LOSS }}
        >
          {profitVal >= 0 ? '▲ Profit' : '▼ Loss'}: {formatEUR(Math.abs(profitVal))}
        </div>
      )}
    </div>
  );
}

export default function DailyRevenueTrend({ data }) {
  if (!data?.length) {
    return <div className={styles.empty}>No daily data available</div>;
  }

  // Show every 3rd tick on the X-axis to avoid crowding in a 28–31 day range
  const tickInterval = data.length > 20 ? 2 : 1;

  return (
    <div className={styles.chartWrap}>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
          <XAxis
            dataKey="day"
            tick={{ fill: '#888', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            interval={tickInterval}
          />
          <YAxis
            tickFormatter={formatEURCompact}
            tick={{ fill: '#888', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={72}
            domain={['auto', 'auto']}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Legend
            formatter={(value) => {
              const labels = {
                revenue: 'Revenue',
                costRate: 'Daily Cost Rate',
                profit: 'Profit / Loss',
              };
              return <span style={{ color: '#ccc', fontSize: 12 }}>{labels[value] || value}</span>;
            }}
          />

          {/* Profit/loss area (behind bars) */}
          <Area
            type="monotone"
            dataKey="profit"
            stroke="none"
            fill={COLOR_PROFIT}
            fillOpacity={0.10}
            name="Profit / Loss"
            legendType="none"
          />

          {/* Revenue bars — green if has data, dim if not */}
          <Bar dataKey="revenue" name="Revenue" radius={[3, 3, 0, 0]} maxBarSize={18}>
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.hasData ? COLOR_REVENUE : COLOR_NO_DATA}
                fillOpacity={entry.hasData ? 0.85 : 0.4}
              />
            ))}
          </Bar>

          {/* Flat daily cost rate reference line */}
          <Line
            type="monotone"
            dataKey="costRate"
            stroke={COLOR_COST}
            strokeWidth={1.5}
            strokeDasharray="5 3"
            dot={false}
            activeDot={false}
            name="Daily Cost Rate"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
