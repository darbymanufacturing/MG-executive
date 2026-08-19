import { useState, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Upload, FileText, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import Button from '../Shared/Button.jsx';
import { parseStripeCSV } from '../../utils/parseStripeCsv.js';
import { useRevenue } from '../../context/RevenueContext.jsx';
import { useCosts } from '../../context/CostContext.jsx';
import { DEFAULT_CONFIG } from '../../utils/constants.js';
import { vatSplit } from '../../utils/vat.js';
import { formatEUR, formatDate, formatPercent } from '../../utils/formatters.js';
import styles from './CsvImportPanel.module.css';

/** 'YYYY-MM' → 'July 2026' */
function monthLabelFor(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

/** Group parsed day-rows by calendar month, summing stripeFees per month. */
function monthlyFeeBreakdown(rows) {
  const byMonth = new Map();
  rows.forEach((r) => {
    const key = r.date.slice(0, 7);
    byMonth.set(key, (byMonth.get(key) || 0) + (r.stripeFees || 0));
  });
  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([monthKey, amount]) => ({
      monthKey,
      monthLabel: monthLabelFor(monthKey),
      amount: Math.round((amount + Number.EPSILON) * 100) / 100,
    }));
}

export default function StripeImportPanel({ locations }) {
  const { revenueData, importStripeRevenue } = useRevenue();
  const { config, importStripeFees } = useCosts();
  const vatRate = config?.financial?.vatRate ?? DEFAULT_CONFIG.financial.vatRate;
  const fileRef = useRef();
  const [parsed, setParsed] = useState(null); // { rows, errors, total, skipped }
  const [status, setStatus] = useState(null); // { type, text }
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState('');
  // Stripe amounts always include VAT — default checked, unlike the Hopp panel
  // (whose export is already ex-VAT). Still user-editable in case a future
  // export ever reports net amounts.
  const [amountsIncludeVat, setAmountsIncludeVat] = useState(true);
  const [bookFees, setBookFees] = useState(true);

  // Single point where the VAT split is applied — both the preview table and
  // the actual commit (handleImport) read from this same memoized array, so
  // the adjustment is computed exactly once and never double-applied.
  const displayRows = useMemo(() => {
    if (!parsed?.rows?.length) return [];
    return parsed.rows.map((r) => {
      if (!amountsIncludeVat) return { ...r, totalPaidRevenue: r.grossInclVat, vatAmount: 0 };
      const { net, vat } = vatSplit(r.grossInclVat, vatRate);
      return { ...r, totalPaidRevenue: net, vatAmount: vat };
    });
  }, [parsed, amountsIncludeVat, vatRate]);

  // Only compare against Stripe's OWN prior imports — a Hopp row for the same
  // date+location is a different document (the doc id carries a 'stripe'
  // suffix) and must never be shown as "will update" here.
  const existingDates = new Set(
    revenueData
      .filter((r) => r.source === 'stripe-xslide' && (!selectedLocation || r.location === selectedLocation))
      .map((r) => r.date),
  );

  const totalFees = parsed ? parsed.rows.reduce((s, r) => s + (r.stripeFees || 0), 0) : 0;

  function handleFile(file) {
    if (!file) return;
    const MAX_SIZE = 50 * 1024 * 1024; // 50MB
    if (file.size > MAX_SIZE) {
      setStatus({ type: 'error', text: 'File too large. Maximum size is 50MB.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = parseStripeCSV(e.target.result);
      setParsed(result);
      setStatus(null);
    };
    reader.readAsText(file);
  }

  function onFileChange(e) { handleFile(e.target.files?.[0]); e.target.value = ''; }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files?.[0]);
  }

  async function handleImport() {
    if (!parsed?.rows?.length) return;
    setLoading(true);
    try {
      // displayRows already carries the VAT split (if any) — see the useMemo
      // above. Do NOT re-apply vatSplit here, that would double-strip.
      const rows = displayRows.map((r) => ({ ...r, location: selectedLocation || null }));
      await importStripeRevenue(rows);

      let feeMsg = '';
      if (bookFees && totalFees > 0) {
        const monthly = monthlyFeeBreakdown(parsed.rows);
        await importStripeFees(monthly);
        feeMsg = ` · ${formatEUR(totalFees)} in Stripe fees booked as ${monthly.length} cost ${monthly.length === 1 ? 'entry' : 'entries'}.`;
      }

      const newCount    = parsed.rows.filter((r) => !existingDates.has(r.date)).length;
      const updateCount = parsed.rows.length - newCount;
      setStatus({
        type: 'success',
        text: `✓ Imported ${parsed.rows.length} days — ${newCount} new, ${updateCount} updated.${feeMsg}`,
      });
      setParsed(null);
    } catch (err) {
      setStatus({ type: 'error', text: `Import failed: ${err.message}` });
    }
    setLoading(false);
  }

  const newCount    = parsed ? parsed.rows.filter((r) => !existingDates.has(r.date)).length : 0;
  const updateCount = parsed ? parsed.rows.length - newCount : 0;

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <Upload size={16} className={styles.icon} />
        <span className={styles.panelTitle}>Import Stripe Revenue (XSlide)</span>
      </div>
      <p className={styles.desc}>
        Upload a Stripe payments export. This is <strong>additional</strong> revenue, kept
        separate from any Hopp data on the same day — it will never overwrite a Hopp entry,
        and no 19% platform fee is deducted from it.
      </p>

      {/* Drop zone */}
      {!parsed && (
        <div
          className={`${styles.dropZone} ${dragging ? styles.dragging : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
        >
          <FileText size={28} className={styles.dropIcon} />
          <p className={styles.dropText}>Drop your Stripe CSV export here, or <span>click to browse</span></p>
          <p className={styles.dropHint}>unified_payments-*.csv</p>
        </div>
      )}
      <input type="file" accept=".csv,text/csv" ref={fileRef} style={{ display: 'none' }} onChange={onFileChange} />

      {/* Errors/warnings from parser */}
      {parsed?.errors?.length > 0 && (
        <div className={styles.errorBox}>
          <AlertCircle size={14} />
          {parsed.errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      {/* Preview */}
      {parsed && parsed.rows.length > 0 && (
        <>
          <label className={styles.vatToggle}>
            <input
              type="checkbox"
              checked={amountsIncludeVat}
              onChange={(e) => setAmountsIncludeVat(e.target.checked)}
            />
            <span>Do these amounts include VAT ({formatPercent(vatRate * 100)})?</span>
          </label>
          {amountsIncludeVat && (
            <p className={styles.vatNote}>
              Amounts will be stored net of {formatPercent(vatRate * 100)} VAT.
            </p>
          )}

          {totalFees > 0 && (
            <label className={styles.vatToggle}>
              <input
                type="checkbox"
                checked={bookFees}
                onChange={(e) => setBookFees(e.target.checked)}
              />
              <span>Also record {formatEUR(totalFees)} in Stripe processing fees as a cost</span>
            </label>
          )}

          <div className={styles.summary}>
            <CheckCircle size={14} className={styles.summaryIcon} />
            <span>
              <strong>{parsed.total}</strong> days parsed
              {newCount > 0 && <> · <strong className={styles.new}>{newCount} new</strong></>}
              {updateCount > 0 && <> · <strong className={styles.update}>{updateCount} will update</strong></>}
              {parsed.skipped > 0 && <> · <strong className={styles.err}>{parsed.skipped} skipped</strong></>}
              {parsed.errors.length > 0 && <> · <strong className={styles.warn}>{parsed.errors.length} warning{parsed.errors.length === 1 ? '' : 's'}</strong></>}
            </span>
          </div>

          <div className={styles.previewWrap}>
            <table className={styles.previewTable}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Charges</th>
                  <th>Users</th>
                  <th className={styles.right}>Gross (incl. VAT)</th>
                  <th className={styles.right}>VAT</th>
                  <th className={styles.right}>Net Revenue</th>
                  <th className={styles.right}>Stripe Fee</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.slice(0, 10).map((r) => (
                  <tr key={r.date} className={existingDates.has(r.date) ? styles.updateRow : ''}>
                    <td>{formatDate(r.date)}</td>
                    <td>{r.chargeCount}</td>
                    <td>{r.uniqueUsersCount}</td>
                    <td className={styles.right}>{formatEUR(r.grossInclVat)}</td>
                    <td className={styles.right}>{formatEUR(r.vatAmount)}</td>
                    <td className={styles.right}>{formatEUR(r.totalPaidRevenue)}</td>
                    <td className={styles.right}>{formatEUR(r.stripeFees)}</td>
                    <td>
                      <span className={existingDates.has(r.date) ? styles.badgeUpdate : styles.badgeNew}>
                        {existingDates.has(r.date) ? 'update' : 'new'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.rows.length > 10 && (
              <p className={styles.more}>…and {parsed.rows.length - 10} more rows</p>
            )}
          </div>

          {/* Location assignment */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
              Which location is this data for?
            </span>
            {locations?.length > 0 ? (
              <select
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 'var(--text-sm)',
                  padding: '6px 10px',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value="">All Locations (fleet-wide)</option>
                {locations.map((loc) => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
              </select>
            ) : (
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                No cities configured — add them in <Link to="/settings" style={{ color: 'var(--color-primary-light)' }}>Settings</Link>.
              </span>
            )}
          </div>

          <div className={styles.actions}>
            <Button variant="secondary" size="sm" onClick={() => setParsed(null)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleImport} disabled={loading}>
              {loading ? <><RefreshCw size={13} className={styles.spin} /> Importing…</> : `Import ${parsed.total} Days`}
            </Button>
          </div>
        </>
      )}

      {/* Status message */}
      {status && (
        <div className={`${styles.statusMsg} ${status.type === 'error' ? styles.statusError : styles.statusSuccess}`}>
          {status.text}
        </div>
      )}
    </div>
  );
}
