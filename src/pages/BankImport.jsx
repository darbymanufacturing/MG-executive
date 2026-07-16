import { useState } from 'react';
import { Upload, SlidersHorizontal } from 'lucide-react';
import { BankRulesProvider } from '../context/BankRulesContext.jsx';
import BankImportPanel from '../components/Bank/BankImportPanel.jsx';
import BankDataStatus from '../components/Bank/BankDataStatus.jsx';
import BankReviewTable from '../components/Bank/BankReviewTable.jsx';
import LoanImportReview from '../components/Bank/LoanImportReview.jsx';
import RulesManager from '../components/Bank/RulesManager.jsx';
import styles from './BankImport.module.css';

/**
 * FF-2 — Bank Import page. Tab 1: upload an Alpha Bank account CSV → review the
 * auto-categorized transactions → commit money-out rows to the cost history.
 * Tab 2: founder-editable categorization rules (Phase B). Wrapped in
 * BankRulesProvider so the rules listener is scoped to this page only.
 */
export default function BankImport() {
  const [tab, setTab] = useState('import');
  const [parsed, setParsed] = useState(null);
  const [parsedLoan, setParsedLoan] = useState(null);

  return (
    <BankRulesProvider>
      <div className={styles.page}>
        <header className={styles.head}>
          <h1 className={styles.title}>Bank Import</h1>
          <p className={styles.sub}>
            Turn your Alpha Bank CSV export into a clean, categorized cost history.
          </p>
        </header>

        <div className={styles.tabs}>
          <button
            className={tab === 'import' ? styles.tabActive : styles.tab}
            onClick={() => setTab('import')}
          >
            <Upload size={14} /> Import
          </button>
          <button
            className={tab === 'rules' ? styles.tabActive : styles.tab}
            onClick={() => setTab('rules')}
          >
            <SlidersHorizontal size={14} /> Rules
          </button>
        </div>

        {tab === 'import' ? (
          parsedLoan ? (
            <LoanImportReview result={parsedLoan} onBack={() => setParsedLoan(null)} />
          ) : parsed ? (
            <BankReviewTable result={parsed} onBack={() => setParsed(null)} />
          ) : (
            <>
              {/* How current the imported bank history is + what to export next */}
              <BankDataStatus />
              <BankImportPanel onParsed={setParsed} onParsedLoan={setParsedLoan} />
            </>
          )
        ) : (
          <RulesManager />
        )}
      </div>
    </BankRulesProvider>
  );
}
