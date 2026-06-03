import LoanBalanceChart from './LoanBalanceChart.jsx';
import {
  totalPrincipalPaid, totalInterest, percentPaid,
  nextInstallmentEstimate, originalPrincipalEstimate,
} from '../../utils/loanCalculations.js';
import { formatEUR, formatDate } from '../../utils/formatters.js';
import styles from './LoanDetail.module.css';

/** FF-2 — loan detail: outstanding hero, payoff progress, principal-vs-interest split, chart, ledger. */
export default function LoanDetail({ loan }) {
  if (!loan) return null;
  const pct = percentPaid(loan);
  const principal = totalPrincipalPaid(loan);
  const interest = totalInterest(loan);
  const next = nextInstallmentEstimate(loan);
  const orig = originalPrincipalEstimate(loan);
  const entries = [...(loan.entries ?? [])].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className={styles.detail}>
      <div className={styles.heroRow}>
        <div>
          <div className={styles.heroLabel}>Outstanding balance · {loan.name}</div>
          <div className={styles.hero}>{loan.currentBalance != null ? formatEUR(loan.currentBalance) : '—'}</div>
        </div>
        {next != null && (
          <div className={styles.nextBox}>
            <span className={styles.metaLabel}>Next installment ≈</span>
            <span className={styles.metaValue}>{formatEUR(next)}</span>
          </div>
        )}
      </div>

      {pct != null && (
        <div className={styles.progressWrap}>
          <div className={styles.progressBar}><div className={styles.progressFill} style={{ width: `${pct}%` }} /></div>
          <div className={styles.progressText}>
            {pct.toFixed(1)}% paid {orig != null && <span className={styles.muted}>· of ~{formatEUR(orig)} original (approx)</span>}
          </div>
        </div>
      )}

      <div className={styles.splitRow}>
        <div className={styles.splitCard}>
          <span className={styles.metaLabel}>Principal repaid</span>
          <span className={styles.metaValue}>{formatEUR(principal)}</span>
          <span className={styles.note}>debt paydown — not a cost</span>
        </div>
        <div className={`${styles.splitCard} ${styles.interestCard}`}>
          <span className={styles.metaLabel}>Interest paid</span>
          <span className={styles.metaValueDanger}>{formatEUR(interest)}</span>
          <span className={styles.note}>the real P&amp;L cost</span>
        </div>
      </div>

      <LoanBalanceChart loan={loan} />

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th className={styles.right}>Principal</th>
              <th className={styles.right}>Interest</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e._bankTxId}>
                <td className={styles.nowrap}>{formatDate(e.date)}</td>
                <td>{e.type === 'interest' ? 'Interest' : e.type === 'installment' ? 'Installment' : 'Other'}</td>
                <td className={styles.right}>{e.principal ? formatEUR(e.principal) : '—'}</td>
                <td className={`${styles.right} ${e.interest ? styles.danger : ''}`}>{e.interest ? formatEUR(e.interest) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
