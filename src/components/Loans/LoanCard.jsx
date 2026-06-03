import { percentPaid, nextInstallmentEstimate } from '../../utils/loanCalculations.js';
import { formatEUR } from '../../utils/formatters.js';
import styles from './LoanCard.module.css';

/** FF-2 — a card per loan: name, outstanding (hero), payoff %, next installment. */
export default function LoanCard({ loan, active, onClick }) {
  const pct = percentPaid(loan);
  const next = nextInstallmentEstimate(loan);
  return (
    <button className={`${styles.card} ${active ? styles.active : ''}`} onClick={onClick} type="button">
      <div className={styles.name}>{loan.name}</div>
      <div className={styles.bal}>{loan.currentBalance != null ? formatEUR(loan.currentBalance) : '—'}</div>
      <div className={styles.sub}>outstanding</div>
      {pct != null && (
        <div className={styles.bar}><div className={styles.fill} style={{ width: `${pct}%` }} /></div>
      )}
      <div className={styles.foot}>
        {pct != null ? `${pct.toFixed(0)}% paid` : '—'}
        {next != null && <span> · next ≈ {formatEUR(next)}</span>}
      </div>
    </button>
  );
}
