import {
  ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { balanceSeries } from '../../utils/loanCalculations.js';
import { formatEUR } from '../../utils/formatters.js';

/** FF-2 — declining principal balance (line) + interest accrued per period (bars). */
export default function LoanBalanceChart({ loan }) {
  const data = balanceSeries(loan);
  if (!data.length) return null;
  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--color-text-muted)" />
          <YAxis
            tick={{ fontSize: 11 }}
            stroke="var(--color-text-muted)"
            width={56}
            tickFormatter={(v) => `€${Math.round(v / 1000)}k`}
          />
          <Tooltip formatter={(v, n) => [formatEUR(v), n === 'balance' ? 'Balance' : 'Interest']} />
          <Bar isAnimationActive={false} dataKey="interest" name="interest" fill="var(--color-danger)" radius={[3, 3, 0, 0]} barSize={14} />
          <Line isAnimationActive={false} type="monotone" dataKey="balance" name="balance" stroke="var(--accent)" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
