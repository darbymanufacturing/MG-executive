import styles from './Money.module.css';
import { formatEUR } from '../../utils/formatters.js';

/**
 * One-line company-health verdict (ADR-0025). Tone is derived from the period P&L
 * (the canonical `displayPnL` from the numbers hub). This is the headline of the
 * Money overview — the first thing a founder reads.
 */
export default function VerdictCard({ pnl, periodLabel = 'this month' }) {
  const hasData = typeof pnl === 'number' && isFinite(pnl);
  let tone = 'muted';
  let title = 'Not enough data yet';
  let sub = 'Add costs and revenue to see your bottom line.';

  if (hasData) {
    if (pnl > 0) {
      tone = 'green';
      title = `Profitable ${periodLabel}`;
      sub = 'Money in beats money out, after Hopp fee and SIM.';
    } else if (pnl === 0) {
      tone = 'amber';
      title = `Breaking even ${periodLabel}`;
      sub = 'Money in matches money out, after Hopp fee and SIM.';
    } else {
      tone = 'red';
      title = 'Spending more than you earn';
      sub = `Money out exceeds money in ${periodLabel}, after Hopp fee and SIM.`;
    }
  }

  return (
    <div className={`${styles.verdict} ${styles[tone]}`}>
      <div className={styles.verdictLeft}>
        <span className={styles.verdictDot} />
        <div>
          <div className={styles.verdictTitle}>{title}</div>
          <div className={styles.verdictSub}>{sub}</div>
        </div>
      </div>
      <div className={styles.verdictRight}>
        <div className={styles.verdictNetLabel}>Net {periodLabel}</div>
        <div className={styles.verdictNet}>
          {hasData ? `${pnl > 0 ? '+' : ''}${formatEUR(pnl)}` : '—'}
        </div>
      </div>
    </div>
  );
}
