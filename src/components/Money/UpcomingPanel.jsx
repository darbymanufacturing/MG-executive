import { CalendarClock, Clock, Check, RotateCcw } from 'lucide-react';
import styles from './Money.module.css';
import { formatEUR, formatDate } from '../../utils/formatters.js';

/**
 * "What's coming" — the projected payment calendar (ADR-0025) with the settlement
 * ledger (ADR-0027). Reads from the hub's getUpcoming() + getHandled(); never computes
 * its own totals. When `onMark` is supplied, each upcoming row can be ticked
 * Committed / Paid (which drops it from "still to pay"), and a "Handled this month"
 * section lists what's been committed/paid with one-click undo.
 *
 * @param onMark (costId, period, status|null) => void   status: 'committed'|'paid'|null(undo)
 */
export default function UpcomingPanel({ upcoming, handled, onMark, title = "What's coming", max = 6 }) {
  const items = upcoming?.items ?? [];
  const horizon = upcoming?.horizonDays ?? 30;
  const shown = items.slice(0, max);
  const extra = items.length - shown.length;

  const committed = handled?.committed ?? [];
  const paid = handled?.paid ?? [];
  const hasHandled = committed.length + paid.length > 0;

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <CalendarClock size={18} className={styles.panelIcon} aria-hidden="true" />
        <span className={styles.panelTitle}>{title}</span>
        <span className={styles.panelMeta}>next {horizon} days</span>
      </div>

      {items.length === 0 ? (
        <div className={styles.empty}>
          {hasHandled
            ? 'All caught up — nothing left to pay in this window.'
            : `Nothing projected in the next ${horizon} days.`}
        </div>
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
                <span className={styles.rowRight}>
                  <span className={styles.rowVal}>{formatEUR(it.horizonTotal)}</span>
                  {onMark && it.period && (
                    <span className={styles.actions}>
                      <button
                        type="button" className={styles.markBtn} title="Mark committed"
                        aria-label={`Mark ${it.name} committed`}
                        onClick={() => onMark(it.id, it.period, 'committed')}
                      >
                        <Clock size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button" className={`${styles.markBtn} ${styles.markPaid}`} title="Mark paid"
                        aria-label={`Mark ${it.name} paid`}
                        onClick={() => onMark(it.id, it.period, 'paid')}
                      >
                        <Check size={14} aria-hidden="true" />
                      </button>
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
          {extra > 0 && <div className={styles.sub}>+{extra} more</div>}
          <div className={styles.total}>
            <span className={styles.totalLabel}>Still to pay ({horizon}d)</span>
            <span className={styles.totalVal} style={{ color: 'var(--status-amber)' }}>
              {formatEUR(upcoming.total)}
            </span>
          </div>
        </>
      )}

      {hasHandled && (
        <div className={styles.handled}>
          <div className={styles.handledHead}>Handled this month</div>
          {committed.length > 0 && (
            <div className={styles.handledChipRow}>
              <span className={styles.chipCommitted}>Committed · {committed.length}</span>
              <span className={styles.handledTot}>{formatEUR(handled.committedTotal)}</span>
            </div>
          )}
          {paid.length > 0 && (
            <div className={styles.handledChipRow}>
              <span className={styles.chipPaid}>Paid · {paid.length}</span>
              <span className={styles.handledTot}>{formatEUR(handled.paidTotal)}</span>
            </div>
          )}
          <div className={styles.handledList}>
            {[...committed, ...paid].map((h) => (
              <div key={`${h.id}-${h.status}`} className={styles.handledRow}>
                <span className={`${styles.dot} ${h.status === 'paid' ? styles.dotPaid : styles.dotCommitted}`} aria-hidden="true" />
                <span className={styles.handledName}>{h.name}</span>
                <span className={styles.handledAmt}>{formatEUR(h.amount)}</span>
                {onMark && (
                  <button
                    type="button" className={styles.undoBtn} title="Move back to to-pay"
                    aria-label={`Undo ${h.name}`}
                    onClick={() => onMark(h.id, h.period, null)}
                  >
                    <RotateCcw size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
