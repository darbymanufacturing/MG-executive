import { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import Button from '../Shared/Button.jsx';
import { parseEventsCSV } from '../../utils/sprCsvParser.js';
import { useSpr } from '../../context/SprContext.jsx';
import { useCosts } from '../../context/CostContext.jsx';
import styles from './EventImportPanel.module.css';

export default function EventImportPanel({ city }) {
  const { sprConfig, importEvents } = useSpr();
  const { config } = useCosts();
  const fileRef   = useRef();

  const [parsed,   setParsed]   = useState(null);
  const [status,   setStatus]   = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selectedCity, setSelectedCity] = useState(city || '');

  const locations = config.locations || [];
  const zones     = (sprConfig.zones || []).filter((z) => !selectedCity || z.city === selectedCity);

  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = parseEventsCSV(e.target.result, zones);
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
      await importEvents(parsed.rows, selectedCity || null);
      setStatus({
        type: 'success',
        text: `✓ Imported ${parsed.rows.length} event${parsed.rows.length !== 1 ? 's' : ''}${parsed.errors.length ? ` · ${parsed.errors.length} skipped` : ''}.`,
      });
      setParsed(null);
    } catch (err) {
      setStatus({ type: 'error', text: `Import failed: ${err.message}` });
    }
    setLoading(false);
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <Upload size={16} className={styles.icon} />
        <span className={styles.panelTitle}>Import Events CSV</span>
      </div>
      <p className={styles.desc}>
        Upload a Raw_Rebalance export from your platform. Required columns: <code>ScooterID</code>, <code>DATE &amp; TIME</code>, <code>Lat</code>, <code>Lon</code>, <code>Rebalance State</code>.
        Zones are auto-assigned based on GPS coordinates.
      </p>

      {!parsed && (
        <div
          className={`${styles.dropZone} ${dragging ? styles.dragging : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
        >
          <FileText size={28} className={styles.dropIcon} />
          <p className={styles.dropText}>Drop your CSV here, or <span>click to browse</span></p>
          <p className={styles.dropHint}>Raw_Rebalance export (.csv)</p>
        </div>
      )}
      <input type="file" accept=".csv,text/csv" ref={fileRef} style={{ display: 'none' }} onChange={onFileChange} />

      {parsed?.errors?.length > 0 && (
        <div className={styles.errorBox}>
          <AlertCircle size={14} />
          {parsed.errors.slice(0, 5).map((e, i) => <div key={i}>{e}</div>)}
          {parsed.errors.length > 5 && <div>…and {parsed.errors.length - 5} more</div>}
        </div>
      )}

      {parsed && parsed.rows.length > 0 && (
        <>
          <div className={styles.summary}>
            <CheckCircle size={14} className={styles.summaryIcon} />
            <span>
              <strong>{parsed.total}</strong> events parsed
              {parsed.errors.length > 0 && <> · <strong className={styles.err}>{parsed.errors.length} skipped</strong></>}
            </span>
          </div>

          <div className={styles.previewWrap}>
            <table className={styles.previewTable}>
              <thead>
                <tr>
                  <th>Scooter</th>
                  <th>Datetime</th>
                  <th>Action</th>
                  <th>Rebalance</th>
                  <th>Zone</th>
                  <th className={styles.right}>Battery</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 10).map((r, i) => (
                  <tr key={i}>
                    <td>{r.scooterId}</td>
                    <td>{r.datetime?.replace('T', ' ')}</td>
                    <td>{r.action || r.afterState || '—'}</td>
                    <td>{r.rebalanceState || '—'}</td>
                    <td>
                      {r.zone
                        ? <span className={styles.zoneTag}>{r.zone}</span>
                        : <span className={styles.noZone}>unmatched</span>}
                    </td>
                    <td className={styles.right}>{r.batteryLevel !== null ? `${r.batteryLevel}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.rows.length > 10 && (
              <p className={styles.more}>…and {parsed.rows.length - 10} more rows</p>
            )}
          </div>

          {locations.length > 0 && (
            <div className={styles.cityRow}>
              <span className={styles.cityLabel}>City / Location:</span>
              <select
                className={styles.select}
                value={selectedCity}
                onChange={(e) => setSelectedCity(e.target.value)}
              >
                <option value="">No city tag</option>
                {locations.map((loc) => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
              </select>
            </div>
          )}

          <div className={styles.actions}>
            <Button variant="secondary" size="sm" onClick={() => setParsed(null)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleImport} disabled={loading}>
              {loading
                ? <><RefreshCw size={13} className={styles.spin} /> Importing…</>
                : `Import ${parsed.total} Events`}
            </Button>
          </div>
        </>
      )}

      {status && (
        <div className={`${styles.statusMsg} ${status.type === 'error' ? styles.statusError : styles.statusSuccess}`}>
          {status.text}
        </div>
      )}
    </div>
  );
}
