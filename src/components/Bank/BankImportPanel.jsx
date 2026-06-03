import { useState, useRef } from 'react';
import { Upload, FileText, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import Button from '../Shared/Button.jsx';
import { parseAlphaBankCsv, reconcile } from '../../utils/parseAlphaBankCsv.js';
import { formatEUR, formatDate } from '../../utils/formatters.js';
import styles from './BankImportPanel.module.css';

/**
 * FF-2 — Alpha Bank CSV upload step. Parses the file, shows feed type, row count,
 * date range, opening/closing balance and the (advisory) reconciliation cue, then
 * hands the parsed result up via onParsed.
 */
export default function BankImportPanel({ onParsed }) {
  const fileRef = useRef();
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);

  function handleFile(file) {
    if (!file) return;
    const MAX = 25 * 1024 * 1024; // 25MB
    if (file.size > MAX) { setError('File too large (max 25MB).'); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      setError(null);
      const parsed = parseAlphaBankCsv(e.target.result);
      setResult(parsed);
    };
    reader.readAsText(file);
  }

  function onChange(e) { handleFile(e.target.files?.[0]); e.target.value = ''; }
  function onDrop(e) { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]); }

  const rec = result?.feedType === 'account' ? reconcile(result) : null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <Upload size={16} className={styles.icon} />
        <span className={styles.title}>Import Alpha Bank CSV</span>
      </div>
      <p className={styles.desc}>
        Upload your Alpha Bank account export (<code>.csv</code>). Money out becomes
        categorized cost entries you review before committing; money in is shown for
        reconciliation only.
      </p>

      <div
        className={`${styles.dropZone} ${dragging ? styles.dragging : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
      >
        <FileText size={26} className={styles.dropIcon} />
        <p className={styles.dropText}>Drop your CSV here, or <span>click to browse</span></p>
        <p className={styles.dropHint}>Κινήσεις Λογαριασμού — Alpha Bank export</p>
      </div>
      <input type="file" accept=".csv,text/csv" ref={fileRef} style={{ display: 'none' }} onChange={onChange} />

      {error && <div className={styles.errorBox}><AlertCircle size={14} /> {error}</div>}

      {result?.feedType === 'loan' && (
        <div className={styles.warnBox}>
          <AlertCircle size={14} /> This looks like a <strong>loan</strong> export — import it from the <strong>Loans</strong> page.
        </div>
      )}

      {result?.feedType === 'unknown' && result.errors?.length > 0 && (
        <div className={styles.errorBox}><AlertCircle size={14} /> {result.errors[0]}</div>
      )}

      {result?.feedType === 'account' && (
        <div className={styles.detected}>
          <div className={styles.metaGrid}>
            <Meta label="Transactions" value={result.rowCount} />
            <Meta label="Date range" value={result.dateRange.from ? `${formatDate(result.dateRange.from)} → ${formatDate(result.dateRange.to)}` : '—'} />
            <Meta label="Opening balance" value={result.openingBalance != null ? formatEUR(result.openingBalance) : '—'} />
            <Meta label="Closing balance" value={result.closingBalance != null ? formatEUR(result.closingBalance) : '—'} />
          </div>

          {rec && (
            <div className={`${styles.recon} ${rec.ok ? styles.reconOk : styles.reconBad}`}>
              {rec.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
              {rec.ok
                ? <span>These {result.rowCount} transactions reconcile to the statement balance change.</span>
                : <span>Reconciliation off by {formatEUR(Math.abs(rec.diff))} — review for missing or duplicate rows.</span>}
            </div>
          )}
          {!rec && (
            <div className={styles.reconNote}>Balance not found in the file — reconciliation unavailable (advisory only).</div>
          )}

          {result.errors?.length > 0 && (
            <div className={styles.errorBox}>
              <AlertCircle size={14} /> {result.errors.length} row{result.errors.length > 1 ? 's' : ''} could not be read and will be skipped.
            </div>
          )}

          <div className={styles.actions}>
            <Button variant="secondary" size="sm" onClick={() => setResult(null)}>Choose another file</Button>
            <Button variant="primary" size="sm" onClick={() => onParsed?.(result)} disabled={result.rowCount === 0}>
              Review {result.rowCount} transactions
            </Button>
          </div>
        </div>
      )}
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
