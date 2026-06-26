import { Receipt } from 'lucide-react';
import styles from './Money.module.css';
import { CATEGORIES } from '../../utils/constants.js';
import { formatEUR } from '../../utils/formatters.js';

/**
 * "What we paid" — actuals for the period (ADR-0025). `total` + `byCategory` come
 * from the numbers hub; the bars show the category mix of the period's spend.
 */
export default function PaidPanel({ total = 0, byCategory = {}, label = 'this month', title = 'What we paid' }) {
  const cats = Object.entries(byCategory)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const max = cats.reduce((m, [, v]) => Math.max(m, v), 0) || 1;

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <Receipt size={18} className={styles.panelIcon} aria-hidden="true" />
        <span className={styles.panelTitle}>{title}</span>
        <span className={styles.rowVal} style={{ marginLeft: 'auto' }}>{formatEUR(total)}</span>
      </div>
      <div className={styles.sub} style={{ marginTop: -4, marginBottom: 10 }}>{label}</div>

      <div className={styles.list}>
        {cats.length === 0 ? (
          <div className={styles.empty}>No spend recorded {label}.</div>
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
