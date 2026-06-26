import { Repeat } from 'lucide-react';
import styles from './Money.module.css';
import { CATEGORIES } from '../../utils/constants.js';
import { formatEUR } from '../../utils/formatters.js';

/**
 * "What we have" — your standing monthly commitments (ADR-0025). `monthly` /
 * `byCategory` come from the numbers hub (recurring run-rate; one-time costs
 * contribute 0 to the monthly rate, so this is naturally commitment-only).
 */
export default function CommitmentsPanel({ monthly = 0, annual = 0, byCategory = {}, count = 0, title = 'What we have' }) {
  const cats = Object.entries(byCategory)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const max = cats.reduce((m, [, v]) => Math.max(m, v), 0) || 1;

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <Repeat size={18} className={styles.panelIcon} aria-hidden="true" />
        <span className={styles.panelTitle}>{title}</span>
        <span className={styles.panelMeta}>commitments</span>
      </div>

      <div className={styles.big}>{formatEUR(monthly)}<span className={styles.bigUnit}> /mo</span></div>
      <div className={styles.sub}>{count} active · ≈ {formatEUR(annual)} / year</div>

      <div className={styles.list} style={{ marginTop: 12 }}>
        {cats.length === 0 ? (
          <div className={styles.empty}>No recurring commitments yet.</div>
        ) : (
          cats.map(([key, val]) => (
            <div key={key} className={styles.bar}>
              <span className={styles.barLabel}>{CATEGORIES[key]?.label ?? key}</span>
              <span className={styles.barTrack}>
                <span className={styles.barFill} style={{ width: `${Math.round((val / max) * 100)}%` }} />
              </span>
              <span className={styles.barVal}>{formatEUR(val)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
