import { useState, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Upload, FileText, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import Button from '../Shared/Button.jsx';
import { parseRevenueCSV } from '../../utils/csvParser.js';
import { useRevenue } from '../../context/RevenueContext.jsx';
import { useCosts } from '../../context/CostContext.jsx';
import { DEFAULT_CONFIG } from '../../utils/constants.js';
import { stripVat } from '../../utils/vat.js';
import { formatEUR, formatDate, formatPercent } from '../../utils/formatters.js';
import styles from './CsvImportPanel.module.css';

// Monetary fields on a parsed revenue row that are eligible for VAT stripping when
// the source CSV reports gross (VAT-included) amounts. Deliberately EXCLUDES:
// - `totalVat` / `refundedVat` — already-computed VAT figures from the export, not
//   gross amounts to strip VAT out of;
// - `vatRate` — metadata (the export's own rate), not a monetary amount;
// - trip counts, durations, distance, unique users/vehicles — non-monetary.
const VAT_ADJUSTABLE_FIELDS = [
  'totalRawIncome',
  'totalFreeTripWorth',
  'totalRawRefunds',
  'unpaidUserRevenue',
  'userDebtRefunds',
  'unpaidOrgRevenue',
  'orgDebtRefunds',
  'totalPaidDebt',
  'averagePayment',
  'averageWorth',
  'totalPaidRevenue',
  'totalPaidRefunds',
];

/** Returns a copy of `row` with every VAT-adjustable monetary field stripped of VAT. */
function stripVatFromRow(row, rate) {
  const adjusted = { ...row };
  VAT_ADJUSTABLE_FIELDS.forEach((field) => {
    if (typeof row[field] === 'number') {
      adjusted[field] = stripVat(row[field], rate);
    }
  });
  return adjusted;
}

export default function CsvImportPanel({ locations }) {
  const { revenueData, importRevenueDays } = useRevenue();
  // App convention (DEFAULT_CONFIG comment, src/utils/constants.js): revenue is
  // stored EX-VAT. Guard for config.financial being absent (fresh org before
  // CostContext seeds defaults).
  const { config } = useCosts();
  const vatRate = config?.financial?.vatRate ?? DEFAULT_CONFIG.financial.vatRate;
  const fileRef   = useRef();
  const [parsed,          setParsed]          = useState(null);   // { rows, errors, total }
  const [status,          setStatus]          = useState(null);   // { type, text }
  const [loading,         setLoading]         = useState(false);
  const [dragging,        setDragging]        = useState(false);
  const [selectedLocation, setSelectedLocation] = useState('');
  // Pre-import question (owner ask, VAT-awareness): default = amounts already
  // exclude VAT, so unchecked imports the CSV's own figures unchanged.
  const [amountsIncludeVat, setAmountsIncludeVat] = useState(false);

  // Single point where the VAT division is applied — both the preview table and
  // the actual commit (handleImport) read from this same memoized array, so the
  // adjustment is computed exactly once and never double-applied.
  const displayRows = useMemo(() => {
    if (!parsed?.rows?.length) return [];
    return amountsIncludeVat
      ? parsed.rows.map((r) => stripVatFromRow(r, vatRate))
      : parsed.rows;
  }, [parsed, amountsIncludeVat, vatRate]);

  const existingDates = new Set(
    revenueData
      .filter((r) => !selectedLocation || r.location === selectedLocation)
      .map((r) => r.date)
  );

  function handleFile(file) {
    if (!file) return;
    const MAX_SIZE = 50 * 1024 * 1024; // 50MB
    if (file.size > MAX_SIZE) {
      setStatus({ type: 'error', text: 'File too large. Maximum size is 50MB.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = parseRevenueCSV(e.target.result);
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
      // displayRows already carries the VAT adjustment (if any) — see the useMemo
      // above. Do NOT re-apply stripVat here, that would double-strip.
      const rows = displayRows.map((r) => ({ ...r, location: selectedLocation || null }));
      await importRevenueDays(rows);
      const newCount     = parsed.rows.filter((r) => !existingDates.has(r.date)).length;
      const updateCount  = parsed.rows.length - newCount;
      setStatus({
        type: 'success',
        text: `✓ Imported ${parsed.rows.length} days — ${newCount} new, ${updateCount} updated.`,
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
        <span className={styles.panelTitle}>Import Revenue CSV</span>
      </div>
      <p className={styles.desc}>
        Upload your daily trip analytics CSV export. Existing dates will be updated; new dates will be added.
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
          <p className={styles.dropText}>Drop your CSV file here, or <span>click to browse</span></p>
          <p className={styles.dropHint}>trip-analytics-*.csv</p>
        </div>
      )}
      <input type="file" accept=".csv,text/csv" ref={fileRef} style={{ display: 'none' }} onChange={onFileChange} />

      {/* Errors from parser */}
      {parsed?.errors?.length > 0 && (
        <div className={styles.errorBox}>
          <AlertCircle size={14} />
          {parsed.errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      {/* Preview */}
      {parsed && parsed.rows.length > 0 && (
        <>
          {/* Pre-import VAT question (owner ask, VAT-awareness). Revenue is stored
              EX-VAT by app convention — default unchecked imports the CSV unchanged. */}
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
                  <th>Trips</th>
                  <th>Users</th>
                  <th>Vehicles</th>
                  <th className={styles.right}>Paid Revenue</th>
                  <th className={styles.right}>Avg Payment</th>
                  <th className={styles.right}>Distance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.slice(0, 10).map((r) => (
                  <tr key={r.date} className={existingDates.has(r.date) ? styles.updateRow : ''}>
                    <td>{formatDate(r.date)}</td>
                    <td>{r.totalTrips}</td>
                    <td>{r.uniqueUsersCount}</td>
                    <td>{r.uniqueVehiclesCount}</td>
                    <td className={styles.right}>{formatEUR(r.totalPaidRevenue)}</td>
                    <td className={styles.right}>{formatEUR(r.averagePayment)}</td>
                    <td className={styles.right}>{r.totalTripDistanceKm} km</td>
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
