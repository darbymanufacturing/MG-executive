import { Pencil, Trash2, Landmark, CreditCard } from 'lucide-react';
import {
  isCreditCard, getUtilizationFraction, utilizationStatus, getPayoffPct,
  getMonthlyAmount, lenderLabel, paymentLabel,
} from './loanUiHelpers.js';
import { formatEUR } from '../../utils/formatters.js';
import styles from './LoanCard.module.css';

const STATUS_VAR = {
  green: 'var(--status-green)',
  amber: 'var(--status-amber)',
  red: 'var(--status-red)',
};

/** FF-2 + manual debts — a card per loan/credit card: name, outstanding (hero),
 *  payoff % (loans) or utilization (cards), rate + payment, edit/delete actions. */
export default function LoanCard({ loan, active, onClick, onEdit, onDelete }) {
  const isCard = isCreditCard(loan);
  const utilization = getUtilizationFraction(loan);
  const status = utilizationStatus(utilization);
  const payoff = getPayoffPct(loan);
  const monthly = getMonthlyAmount(loan);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); }
  };

  return (
    <div
      className={`${styles.card} ${active ? styles.active : ''}`}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-pressed={active}
    >
      <div className={styles.top}>
        <span className={styles.typeBadge}>
          {isCard ? <CreditCard size={12} /> : <Landmark size={12} />}
          {isCard ? 'Credit card' : 'Loan'}
        </span>
        <div className={styles.iconActions}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={(e) => { e.stopPropagation(); onEdit?.(loan); }}
            aria-label={`Edit ${loan.name}`}
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
            onClick={(e) => { e.stopPropagation(); onDelete?.(loan); }}
            aria-label={`Delete ${loan.name}`}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className={styles.name}>{loan.name}</div>
      {loan.lender && <div className={styles.lender}>{lenderLabel(loan)} · {loan.lender}</div>}

      <div className={styles.bal}>{loan.currentBalance != null ? formatEUR(loan.currentBalance) : '—'}</div>
      <div className={styles.sub}>
        {isCard
          ? (loan.creditLimit != null ? `of ${formatEUR(loan.creditLimit)} limit` : 'outstanding')
          : 'outstanding'}
      </div>

      {isCard && utilization != null && (
        <>
          <div className={styles.bar}>
            <div className={styles.fill} style={{ width: `${utilization * 100}%`, background: STATUS_VAR[status] }} />
          </div>
          <div className={styles.foot}>{Math.round(utilization * 100)}% utilized</div>
        </>
      )}
      {!isCard && payoff != null && (
        <>
          <div className={styles.bar}><div className={styles.fill} style={{ width: `${payoff}%` }} /></div>
          <div className={styles.foot}>{payoff.toFixed(0)}% paid off</div>
        </>
      )}

      {(loan.interestRate != null || monthly != null) && (
        <div className={styles.metaRow}>
          {loan.interestRate != null && <span>{loan.interestRate}% APR</span>}
          {monthly != null && <span>{paymentLabel(loan)} {formatEUR(monthly)}</span>}
        </div>
      )}
    </div>
  );
}
