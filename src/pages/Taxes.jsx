import { useMemo } from 'react';
import { Percent, Landmark, ReceiptText } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import Header from '../components/Layout/Header.jsx';
import KpiCard from '../components/Dashboard/KpiCard.jsx';
import CategoryBadge from '../components/Costs/CategoryBadge.jsx';
import EmptyState from '../components/Shared/EmptyState.jsx';
import { useMetrics } from '../context/MetricsContext.jsx';
import { taxBreakdown } from '../utils/taxSummary.js';
import { formatEUR, formatEURCompact, formatDate } from '../utils/formatters.js';
import { MONTHS } from '../utils/constants.js';
import styles from './Taxes.module.css';

const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
};

/**
 * Taxes & Duties (ADR-0026 follow-up) — a dedicated view of the owner's government
 * taxes & statutory duties (VAT, ΓΕΜΗ, Company Registration, Customs — the `isTax`
 * categories). Reads fleet-scoped costs from the hub (useMetrics().scopedCosts) and
 * derives the breakdown via the pure taxSummary util; computes no canonical totals.
 */
export default function Taxes() {
  const { scopedCosts } = useMetrics();

  const tax = useMemo(() => taxBreakdown(scopedCosts || []), [scopedCosts]);

  const rows = useMemo(
    () => (scopedCosts || [])
      .filter((c) => tax.categories.some((t) => t.key === c.category))
      .slice()
      .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || ''))),
    [scopedCosts, tax.categories],
  );

  const chartData = useMemo(() => tax.monthly.slice(-12).map((m) => ({
    month: monthLabel(m.month), total: m.total,
  })), [tax.monthly]);

  const maxCat = tax.categories[0]?.total || 1;

  return (
    <div className={styles.page}>
      <Header title="Taxes & Duties" subtitle="What the company actually pays the state" />

      {tax.count === 0 ? (
        <EmptyState
          icon={Percent}
          title="No tax payments recorded yet"
          description="VAT, ΓΕΜΗ, Company Registration and Customs costs will appear here once categorised."
        />
      ) : (
        <>
          <div className={styles.kpis}>
            <KpiCard icon={Percent} label={`Taxes paid in ${tax.year}`} value={formatEUR(tax.totalYTD)}
              sub={`${tax.year} year-to-date`} accent highlight />
            <KpiCard icon={Landmark} label="All-time taxes & duties" value={formatEUR(tax.totalAllTime)}
              sub={`${tax.count} payments`} />
            <KpiCard icon={ReceiptText} label="VAT this year"
              value={formatEUR(tax.categories.find((c) => c.key === 'VAT')?.ytd || 0)}
              sub="largest tax line" />
          </div>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>By type</h2>
            <div className={styles.bars}>
              {tax.categories.map((c) => (
                <div key={c.key} className={styles.barRow}>
                  <div className={styles.barHead}>
                    <CategoryBadge category={c.key} />
                    <span className={styles.barCount}>{c.count}×</span>
                    <span className={styles.barTotal}>{formatEUR(c.total)}</span>
                  </div>
                  <div className={styles.barTrack}>
                    <div
                      className={styles.barFill}
                      style={{ width: `${Math.max(2, (c.total / maxCat) * 100)}%`, background: c.color }}
                    />
                  </div>
                  <div className={styles.barSub}>{formatEUR(c.ytd)} in {tax.year}</div>
                </div>
              ))}
            </div>
          </section>

          {chartData.length > 1 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Monthly tax outflow</h2>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fill: 'var(--fg-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={formatEURCompact} tick={{ fill: 'var(--fg-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={56} />
                    <Tooltip
                      formatter={(v) => [formatEUR(v), 'Taxes']}
                      contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--fg-strong)' }}
                    />
                    <Bar isAnimationActive={false} dataKey="total" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>All tax payments ({rows.length})</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.th}>Date</th>
                    <th className={styles.th}>Description</th>
                    <th className={styles.th}>Type</th>
                    <th className={`${styles.th} ${styles.right}`}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id || c._bankTxId} className={styles.tr}>
                      <td className={styles.td}>{c.startDate ? formatDate(c.startDate) : '—'}</td>
                      <td className={styles.td}>{c.name}</td>
                      <td className={styles.td}><CategoryBadge category={c.category} /></td>
                      <td className={`${styles.td} ${styles.right}`}>{formatEUR(c.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
