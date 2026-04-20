import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { X, Info } from 'lucide-react';
import { formatEUR, formatDate } from '../../utils/formatters.js';
import styles from './ScooterLedgerDetail.module.css';

export default function ScooterLedgerDetail({ row, onClose }) {
  if (!row) return null;

  // Build monthly chart data: merge revenue + repair months
  const chartData = useMemo(() => {
    const keys = new Set([
      ...row.revenueMonthly.map((m) => m.key),
      ...row.repairMonthly.map((m) => m.key),
    ]);
    return Array.from(keys).sort().map((key) => ({
      month: key,
      revenue: row.revenueMonthly.find((m) => m.key === key)?.revenue || 0,
      repair:  row.repairMonthly.find((m) => m.key === key)?.cost    || 0,
    }));
  }, [row]);

  const netColor = row.netPosition >= 0 ? 'var(--color-success)' : 'var(--color-danger)';

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.scooterId}>#{row.scooterId}</span>
          <span className={styles.meta}>{row.model} · {row.city}</span>
        </div>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>

      {/* Summary cards */}
      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <span className={styles.cardLabel}>Purchase Price</span>
          <span className={styles.cardValue}>{row.purchasePrice != null ? formatEUR(row.purchasePrice) : '—'}</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.cardLabel}>Revenue Earned (est.)</span>
          <span className={`${styles.cardValue} ${styles.positive}`}>{formatEUR(row.revenueTotal)}</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.cardLabel}>Repair Cost</span>
          <span className={`${styles.cardValue} ${styles.warning}`}>{formatEUR(row.repairTotal)}</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.cardLabel}>Net Position</span>
          <span className={styles.cardValue} style={{ color: netColor }}>
            {formatEUR(row.netPosition)}
          </span>
        </div>
      </div>

      {/* Attribution disclaimer */}
      <div className={styles.disclaimer}>
        <Info size={13} />
        Revenue is attributed (city total ÷ active fleet per day). Not exact per-trip data.
      </div>

      {/* Monthly chart */}
      {chartData.length > 0 && (
        <div className={styles.chartSection}>
          <p className={styles.sectionTitle}>Monthly Revenue vs Repair Cost</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} />
              <YAxis tickFormatter={(v) => `€${v}`} tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} width={55} />
              <Tooltip
                formatter={(v, name) => [formatEUR(v), name === 'revenue' ? 'Revenue' : 'Repair']}
                contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8 }}
              />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="revenue" fill="var(--color-primary)" radius={[3, 3, 0, 0]} name="Revenue" />
              <Bar dataKey="repair"  fill="var(--color-warning)"  radius={[3, 3, 0, 0]} name="Repair" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Ticket history table */}
      <div className={styles.historySection}>
        <p className={styles.sectionTitle}>Repair History</p>
        {row.byTicket.length === 0 ? (
          <p className={styles.empty}>No repair tickets for this scooter.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Days Down</th>
                  <th>Revenue Lost</th>
                  <th>Parts Cost</th>
                  <th>Labour</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {row.byTicket.map((t) => (
                  <tr key={t._docId}>
                    <td>{formatDate(t.dateEntered)}</td>
                    <td>{t.category || '—'}</td>
                    <td>
                      <span className={`${styles.statusBadge} ${t.status === 'Completed' ? styles.completed : styles.active}`}>
                        {t.status}
                      </span>
                    </td>
                    <td>{t.daysOpen}</td>
                    <td className={styles.warning}>{formatEUR(t.revenueLost)}</td>
                    <td>{formatEUR(t.partsCost)}</td>
                    <td>{t.labourCost > 0 ? formatEUR(t.labourCost) : '—'}</td>
                    <td className={styles.bold}>{formatEUR(t.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
