import { useState } from 'react';
import BankImportPanel from '../components/Bank/BankImportPanel.jsx';
import BankReviewTable from '../components/Bank/BankReviewTable.jsx';
import styles from './BankImport.module.css';

/**
 * FF-2 Phase A — Bank Import page. Upload an Alpha Bank account CSV, review the
 * auto-categorized transactions, then commit money-out rows to the cost history.
 */
export default function BankImport() {
  const [parsed, setParsed] = useState(null);

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Bank Import</h1>
        <p className={styles.sub}>
          Turn your Alpha Bank CSV export into a clean, categorized cost history.
        </p>
      </header>

      {!parsed ? (
        <BankImportPanel onParsed={setParsed} />
      ) : (
        <BankReviewTable result={parsed} onBack={() => setParsed(null)} />
      )}
    </div>
  );
}
