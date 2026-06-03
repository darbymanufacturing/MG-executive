import { useState } from 'react';
import { Link } from 'react-router-dom';
import { HandCoins } from 'lucide-react';
import EmptyState from '../components/Shared/EmptyState.jsx';
import LoanCard from '../components/Loans/LoanCard.jsx';
import LoanDetail from '../components/Loans/LoanDetail.jsx';
import { useLoans } from '../context/LoansContext.jsx';
import styles from './Loans.module.css';

/**
 * FF-2 Phase C — Loans page. Company-wide (ignores the FF-3 fleet switcher):
 * a card per loan + a detail view with a loan switcher. Import loans from the
 * Bank Import page (loan-CSV feed is auto-detected there).
 */
export default function Loans() {
  const { loans, loading } = useLoans();
  const [activeId, setActiveId] = useState(null);

  if (loading) return <div className={styles.page}><p className={styles.muted}>Loading loans…</p></div>;

  if (!loans.length) {
    return (
      <div className={styles.page}>
        <EmptyState
          icon={HandCoins}
          title="No loans yet"
          description={<>Import a loan from your Alpha Bank loan CSV on the <Link to="/bank-import">Bank Import</Link> page.</>}
        />
      </div>
    );
  }

  const active = loans.find((l) => l._docId === activeId) || loans[0];

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Loans</h1>
        <p className={styles.sub}>Company-wide · interest is the real cost, principal is debt paydown.</p>
      </header>
      <div className={styles.layout}>
        <div className={styles.list}>
          {loans.map((l) => (
            <LoanCard key={l._docId} loan={l} active={l._docId === active._docId} onClick={() => setActiveId(l._docId)} />
          ))}
        </div>
        <div className={styles.detailWrap}><LoanDetail loan={active} /></div>
      </div>
    </div>
  );
}
