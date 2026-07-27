import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { HandCoins, Plus, Wallet, CalendarClock, Landmark, CreditCard } from 'lucide-react';
import EmptyState from '../components/Shared/EmptyState.jsx';
import Button from '../components/Shared/Button.jsx';
import ConfirmDialog from '../components/Shared/ConfirmDialog.jsx';
import KpiCard from '../components/Dashboard/KpiCard.jsx';
import LoanCard from '../components/Loans/LoanCard.jsx';
import LoanDetail from '../components/Loans/LoanDetail.jsx';
import LoanFormModal from '../components/Loans/LoanFormModal.jsx';
import {
  hasHistory, isCreditCard, lenderLabel, paymentLabel, principalLabel,
  getPrincipalValue, getMonthlyAmount,
} from '../components/Loans/loanUiHelpers.js';
import { useLoans } from '../context/LoansContext.jsx';
import { formatEUR, formatDate } from '../utils/formatters.js';
import styles from './Loans.module.css';

/**
 * FF-2 Phase C + manual debts — Loans page. Company-wide (ignores the FF-3 fleet
 * switcher): a totals header, an "Add loan / card" action, a card grid (CSV-imported
 * bank loans alongside manually-added loans/credit cards), and a detail panel for the
 * selected card — the real payment history + chart for CSV loans, or a plain summary
 * of the entered fields for manual debts that have no transactions to chart yet.
 */
export default function Loans() {
  const { loans, loading, addLoan, updateLoan, deleteLoan } = useLoans();
  const [activeId, setActiveId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingLoan, setEditingLoan] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const totals = useMemo(() => {
    let outstanding = 0;
    let monthlyService = 0;
    let loanCount = 0;
    let cardCount = 0;
    for (const l of loans) {
      outstanding += l.currentBalance || 0;
      const monthly = getMonthlyAmount(l);
      if (monthly) monthlyService += monthly;
      if (isCreditCard(l)) cardCount += 1; else loanCount += 1;
    }
    return { outstanding, monthlyService, loanCount, cardCount };
  }, [loans]);

  const openAdd = () => { setEditingLoan(null); setFormOpen(true); };
  const openEdit = (loan) => { setEditingLoan(loan); setFormOpen(true); };

  const handleSave = async (data) => {
    if (editingLoan) await updateLoan(editingLoan._docId, data);
    else await addLoan(data);
  };

  if (loading) return <div className={styles.page}><p className={styles.muted}>Loading loans…</p></div>;

  if (!loans.length) {
    return (
      <div className={styles.page}>
        <EmptyState
          icon={HandCoins}
          title="No loans or cards yet"
          description={<>Add a loan or credit card by hand, or import one from your Alpha Bank loan CSV on the <Link to="/bank-import">Bank Import</Link> page.</>}
          action={<Button onClick={openAdd}><Plus size={16} /> Add loan / card</Button>}
        />
        <LoanFormModal isOpen={formOpen} onClose={() => setFormOpen(false)} onSave={handleSave} initialData={editingLoan} />
      </div>
    );
  }

  const active = loans.find((l) => l._docId === activeId) || loans[0];

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.headTop}>
          <div>
            <h1 className={styles.title}>Loans</h1>
            <p className={styles.sub}>Company-wide · interest is the real cost, principal is debt paydown.</p>
          </div>
          <Button onClick={openAdd}><Plus size={16} /> Add loan / card</Button>
        </div>

        <div className={styles.kpiRow}>
          <KpiCard icon={Wallet} label="Total outstanding" value={formatEUR(totals.outstanding)} />
          <KpiCard icon={CalendarClock} label="Monthly debt service" value={formatEUR(totals.monthlyService)} sub="loan + card payments" />
          <KpiCard icon={Landmark} label="Loans" value={totals.loanCount} />
          <KpiCard icon={CreditCard} label="Credit cards" value={totals.cardCount} />
        </div>
      </header>

      <div className={styles.grid}>
        {loans.map((l) => (
          <LoanCard
            key={l._docId}
            loan={l}
            active={l._docId === active._docId}
            onClick={() => setActiveId(l._docId)}
            onEdit={openEdit}
            onDelete={setDeleteTarget}
          />
        ))}
      </div>

      <div className={styles.detailWrap}>
        {hasHistory(active) ? <LoanDetail loan={active} /> : <ManualSummary loan={active} />}
      </div>

      <LoanFormModal isOpen={formOpen} onClose={() => setFormOpen(false)} onSave={handleSave} initialData={editingLoan} />

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          await deleteLoan(deleteTarget._docId);
          if (deleteTarget._docId === activeId) setActiveId(null);
          setDeleteTarget(null);
        }}
        title={isCreditCard(deleteTarget) ? 'Delete credit card' : 'Delete loan'}
        message={`Remove "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
      />
    </div>
  );
}

/** Fallback detail panel for a debt with no transaction history to chart yet
 *  (manually-added loans/cards) — just presents the fields entered in the form. */
function ManualSummary({ loan }) {
  const isCard = isCreditCard(loan);
  return (
    <div className={styles.manual}>
      <div className={styles.manualHeroRow}>
        <div>
          <div className={styles.manualLabel}>{principalLabel(loan)}</div>
          <div className={styles.manualHero}>{formatEUR(getPrincipalValue(loan))}</div>
        </div>
        <div>
          <div className={styles.manualLabel}>Outstanding · {loan.name}</div>
          <div className={styles.manualHero}>{loan.currentBalance != null ? formatEUR(loan.currentBalance) : '—'}</div>
        </div>
      </div>

      <div className={styles.manualMetaGrid}>
        <div className={styles.manualMetaCell}>
          <span className={styles.manualMetaLabel}>{lenderLabel(loan)}</span>
          <span className={styles.manualMetaValue}>{loan.lender || '—'}</span>
        </div>
        <div className={styles.manualMetaCell}>
          <span className={styles.manualMetaLabel}>{isCard ? 'APR' : 'Interest rate'}</span>
          <span className={styles.manualMetaValue}>{loan.interestRate != null ? `${loan.interestRate}%` : '—'}</span>
        </div>
        <div className={styles.manualMetaCell}>
          <span className={styles.manualMetaLabel}>{paymentLabel(loan)}</span>
          <span className={styles.manualMetaValue}>{loan.monthlyPayment != null ? formatEUR(loan.monthlyPayment) : '—'}</span>
        </div>
        <div className={styles.manualMetaCell}>
          <span className={styles.manualMetaLabel}>Start date</span>
          <span className={styles.manualMetaValue}>{loan.startDate ? formatDate(loan.startDate) : '—'}</span>
        </div>
      </div>

      {loan.notes && <p className={styles.manualNotes}>{loan.notes}</p>}

      <p className={styles.manualHint}>
        No transaction history yet — this balance is tracked manually. Import a matching CSV on{' '}
        <Link to="/bank-import">Bank Import</Link> to layer in real payments, or use the pencil icon to edit it any time.
      </p>
    </div>
  );
}
