/**
 * TripImporter — drag-drop CSV importer for scooterTrips.
 * Designed to live inside the Trips tab on /scooters/:id.
 * scooterId is pre-supplied (from the URL), so no picker needed.
 *
 * Flow: upload → parse → preview table → confirm → batch write
 *
 * Handles the Hopp trip-log CSV format:
 *   Type, Started / Created, Ended, User, Length, End reason, Cost, Is Paid
 */

import { useState, useRef, useCallback } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, X } from 'lucide-react';
import { useTrips } from '../../context/TripContext.jsx';
import { parseTripLogCsv } from '../../utils/parseTripLogCsv.js';
import { formatKm, formatMinutes, formatEUR } from '../../utils/formatters.js';
import Button from '../Shared/Button.jsx';
import styles from './TripImporter.module.css';

const MAX_PREVIEW = 10;

function StatusIcon({ type }) {
  if (type === 'success') return <CheckCircle size={16} style={{ color: 'var(--color-success)' }} />;
  if (type === 'error')   return <AlertCircle size={16} style={{ color: 'var(--color-danger)' }} />;
  return null;
}

export default function TripImporter({ scooterId, onImportDone }) {
  const { importTrips, clearTripsForScooter } = useTrips();
  const fileRef = useRef(null);

  const [stage,    setStage]    = useState('idle');   // idle | preview | importing | done | error
  const [preview,  setPreview]  = useState(null);     // { rows, errors, total, fileName }
  const [status,   setStatus]   = useState(null);     // { type, text }
  const [dragging, setDragging] = useState(false);
  const [replaceMode, setReplaceMode] = useState(false);

  const handleFile = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const result = parseTripLogCsv(text, scooterId);
      if (result.errors.length > 0 && result.total === 0) {
        setStage('error');
        setStatus({ type: 'error', text: result.errors[0] });
        return;
      }
      setPreview({ ...result, fileName: file.name });
      setStage('preview');
    };
    reader.readAsText(file, 'UTF-8');
  }, [scooterId]);

  function handleInputChange(e) {
    handleFile(e.target.files?.[0]);
    e.target.value = '';
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files?.[0]);
  }

  async function handleConfirm() {
    if (!preview?.rows?.length) return;
    setStage('importing');
    try {
      if (replaceMode) {
        await clearTripsForScooter(scooterId);
      }
      const { written } = await importTrips(preview.rows);
      setStatus({ type: 'success', text: `${written} trips imported successfully.` });
      setStage('done');
      onImportDone?.();
    } catch (err) {
      setStatus({ type: 'error', text: `Import failed: ${err.message}` });
      setStage('error');
    }
  }

  function reset() {
    setStage('idle');
    setPreview(null);
    setStatus(null);
    setReplaceMode(false);
  }

  // ── Idle / drop zone ──────────────────────────────────────────────────────
  if (stage === 'idle' || stage === 'error') {
    return (
      <div className={styles.wrap}>
        <div
          className={`${styles.dropZone} ${dragging ? styles.dragging : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={28} className={styles.dropIcon} />
          <p className={styles.dropTitle}>Drop your Hopp trip CSV here</p>
          <p className={styles.dropHint}>
            Export from Hopp: Vehicle → Trips tab → Export CSV.<br />
            Trips will be assigned to scooter <strong>#{scooterId}</strong>.
          </p>
          <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}>
            <FileText size={14} /> Choose File
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={handleInputChange}
          />
        </div>

        {stage === 'error' && status && (
          <div className={styles.errorBar}>
            <StatusIcon type="error" />
            {status.text}
          </div>
        )}
      </div>
    );
  }

  // ── Preview ───────────────────────────────────────────────────────────────
  if (stage === 'preview') {
    const displayRows = preview.rows.slice(0, MAX_PREVIEW);
    return (
      <div className={styles.wrap}>
        <div className={styles.previewHeader}>
          <div className={styles.previewMeta}>
            <FileText size={15} />
            <span className={styles.fileName}>{preview.fileName}</span>
            <span className={styles.badge}>{preview.total} trips parsed</span>
            {preview.errors.length > 0 && (
              <span className={styles.badgeWarn}>{preview.errors.length} warnings</span>
            )}
          </div>
          <button className={styles.closeBtn} onClick={reset}><X size={15} /></button>
        </div>

        {/* Parse warnings */}
        {preview.errors.length > 0 && (
          <div className={styles.warnings}>
            {preview.errors.slice(0, 3).map((e, i) => (
              <div key={i} className={styles.warningRow}>
                <AlertCircle size={12} /> {e}
              </div>
            ))}
            {preview.errors.length > 3 && (
              <div className={styles.warningRow}>…and {preview.errors.length - 3} more</div>
            )}
          </div>
        )}

        {/* Stats strip */}
        <div className={styles.statsStrip}>
          <div className={styles.stat}>
            <span className={styles.statVal}>{preview.total}</span>
            <span className={styles.statKey}>Trips</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statVal}>
              {formatKm(preview.rows.reduce((s, r) => s + (r.distanceKm || 0), 0))}
            </span>
            <span className={styles.statKey}>Total Distance</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statVal}>
              {formatMinutes(preview.rows.reduce((s, r) => s + (r.durationMinutes || 0), 0))}
            </span>
            <span className={styles.statKey}>Total Duration</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statVal} style={{ color: 'var(--color-success)' }}>
              {formatEUR(preview.rows.reduce((s, r) => s + (r.cost || 0), 0))}
            </span>
            <span className={styles.statKey}>Total Revenue</span>
          </div>
        </div>

        {/* Preview table */}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Started</th>
                <th>Duration</th>
                <th>Distance</th>
                <th>Revenue</th>
                <th>Paid</th>
                <th>End Reason</th>
                <th>User</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((r, i) => {
                const adjusted = r.isPaid === false && r.costOriginal != null && r.cost !== r.costOriginal;
                return (
                  <tr key={i}>
                    <td>{r.startedAt ? r.startedAt.replace('T', ' ').slice(0, 16) : '—'}</td>
                    <td>{r.durationMinutes != null ? formatMinutes(r.durationMinutes) : '—'}</td>
                    <td>{r.distanceKm     != null ? formatKm(r.distanceKm)           : '—'}</td>
                    <td>
                      {r.cost != null ? (
                        <span style={{ color: adjusted ? 'var(--color-warning)' : 'var(--color-success)' }}
                              title={adjusted ? `Gross: ${formatEUR(r.costOriginal)} — adjusted (unpaid −€5.50), ex-VAT 24%` : `Gross: ${formatEUR(r.costOriginal)} — ex-VAT 24%`}>
                          {formatEUR(r.cost)}{adjusted && ' *'}
                        </span>
                      ) : '—'}
                    </td>
                    <td>
                      {r.isPaid === true  && <span style={{ color: 'var(--color-success)', fontWeight: 700, fontSize: 'var(--text-xs,11px)' }}>Paid</span>}
                      {r.isPaid === false && <span style={{ color: 'var(--color-danger)',  fontWeight: 700, fontSize: 'var(--text-xs,11px)' }}>Unpaid</span>}
                      {r.isPaid == null   && '—'}
                    </td>
                    <td>{r.endReason || '—'}</td>
                    <td className={styles.userId}>{r.userId || '—'}</td>
                  </tr>
                );
              })}
              {preview.total > MAX_PREVIEW && (
                <tr>
                  <td colSpan={6} className={styles.moreRows}>
                    …and {preview.total - MAX_PREVIEW} more trips not shown
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Replace toggle */}
        <label className={styles.replaceToggle}>
          <input
            type="checkbox"
            checked={replaceMode}
            onChange={(e) => setReplaceMode(e.target.checked)}
          />
          <span>Clear existing trips for this scooter before importing</span>
        </label>

        <div className={styles.actions}>
          <Button variant="ghost"   size="sm" onClick={reset}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleConfirm}>
            Import {preview.total} Trips
          </Button>
        </div>
      </div>
    );
  }

  // ── Importing ─────────────────────────────────────────────────────────────
  if (stage === 'importing') {
    return (
      <div className={styles.wrap}>
        <div className={styles.importing}>
          <div className={styles.spinner} />
          <p>Importing {preview?.total} trips…</p>
        </div>
      </div>
    );
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  if (stage === 'done') {
    return (
      <div className={styles.wrap}>
        <div className={styles.doneCard}>
          <CheckCircle size={32} style={{ color: 'var(--color-success)' }} />
          <p className={styles.doneText}>{status?.text}</p>
          <Button variant="ghost" size="sm" onClick={reset}>Import Another File</Button>
        </div>
      </div>
    );
  }

  return null;
}
