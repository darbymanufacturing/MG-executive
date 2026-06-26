import { CalendarClock } from 'lucide-react';
import styles from './Money.module.css';
import { formatEUR, formatDate } from '../../utils/formatters.js';

/**
 * "What's coming" — the projected payment calendar (ADR-0025). Reads a result from
 * the numbers hub's getUpcoming(); never computes its own totals. Amounts shown are
 * the projected charge landing in the window (`horizonTotal`).
 */
export default function UpcomingPanel({ upcoming, title = "What's coming", max = 6 }) {
  const items = upcoming?.items ?? [];
  const horizon = upcoming?.horizonDays ?? 30;
  const shown = items.slice(0, max);
  const extra = items.length - shown.length;

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <CalendarClock size={18} className={styles.panelIcon} aria-hidden="true" />
        <span className={styles.panelTitle}>{title}</span>
        <span className={styles.panelMeta}>next {horizon} days</span>
      </div>

      {items.length === 0 ? (
        <div className={styles.empty}>Nothing projected in the next {horizon} days.</div>
      ) : (
        <>
          <div className={styles.list}>
            {shown.map((it) => (
              <div key={it.id} className={styles.row}>
                <span className={styles.rowLeft}>
                  <span className={styles.rowDate}>{formatDate(it.nextDue)}</span>
                  <span className={styles.rowName}>
                    {it.name}
                    {it.isEstimate && <span className={styles.estimate}> · est</span>}
                  </span>
                </span>
                <span className={styles.rowVal}>{formatEUR(it.horizonTotal)}</span>
              </div>
            ))}
          </div>
          {extra > 0 && <div className={styles.sub}>+{extra} more</div>}
          <div className={styles.total}>
            <span className={styles.totalLabel}>Due in {horizon} days</span>
            <span className={styles.totalVal} style={{ color: 'var(--status-amber)' }}>
              {formatEUR(upcoming.total)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
