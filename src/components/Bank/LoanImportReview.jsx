import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, CheckCircle2 } from 'lucide-react';
import Button from '../Shared/Button.jsx';
import { useLoans } from '../../context/LoansContext.jsx';
import { useCosts } from '../../context/CostContext.jsx';
import { interestCostRows } from '../../utils/loanCalculations.js';
import { formatEUR } from '../../utils/formatters.js';
import styles from './LoanImportReview.module.css';

/**
 * FF-2 Phase C — loan-CSV import review. Saves/merges the loan, then writes its
 * INTEREST entries to the cost history (category 'loan'); principal is excluded
 * (debt paydown, and already a debit in the account feed → no double count).
 */
export default function LoanImportReview({ result, onBack }) {
  const { upsertLoan } = useLoans();
  const { importBankCosts } = useCosts();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);

  const installments = result.entries.filter((e) => e.type === 'installment').length;
  const interestN = result.entries.filter((e) => e.type === 'interest').length;

  async function handleCommit() {
    setBusy(true); setError(null);
    try {
      const loan = await upsertLoan(result);
      const costRes = await importBankCosts(interestCostRows(loan));
      setDone(costRes);
    } catch (err) { setError(`Import failed: ${err.message}`); }
    setBusy(false);
  }

  if (done) {
    return (
      <div className={styles.wrap}>
        <h3 className={styles.title}><CheckCircle2 size={18} /> Loan imported</h3>
        <p className={styles.text}>
          Saved <strong>{result.name}</strong>. {done.written} interest entr{done.written === 1 ? 'y' : 'ies'} added
          to costs{done.duplicates > 0 ? ` (${done.duplicates} already imported)` : ''} — principal excluded.
        </p>
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={onBack}>Import another file</Button>
          <Link to="/loans" className={styles.link}><Button variant="primary" size="sm">View loan →</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <h3 className={styles.title}>{result.name}</h3>
      <div className={styles.metaGrid}>
        <Meta label="Outstanding" value={result.currentBalance != null ? formatEUR(result.currentBalance) : '—'} />
        <Meta label="Installments" value={installments} />
        <Meta label="Interest rows" value={interestN} />
        <Meta label="Total interest" value={formatEUR(result.totalInterest)} />
      </div>
      <p className={styles.note}>
        On import the loan is saved and its <strong>interest</strong> becomes cost entries (category Loan).
        <strong> Principal is excluded</strong> — it&rsquo;s debt paydown, not an expense (and already appears as a debit in your account feed).
      </p>
      {result.errors?.length > 0 && <div className={styles.errorBox}>{result.errors.length} row(s) skipped.</div>}
      {error && <div className={styles.errorBox}>{error}</div>}
      <div className={styles.actions}>
        <Button variant="secondary" size="sm" onClick={onBack}>Back</Button>
        <Button variant="primary" size="sm" onClick={handleCommit} disabled={busy}>
          {busy ? <><RefreshCw size={13} className={styles.spin} /> Importing…</> : 'Import loan'}
        </Button>
      </div>
    </div>
  );
}

function Meta({ label, value }) {
  return (
    <div className={styles.meta}>
      <span className={styles.metaLabel}>{label}</span>
      <span className={styles.metaValue}>{value}</span>
    </div>
  );
}
