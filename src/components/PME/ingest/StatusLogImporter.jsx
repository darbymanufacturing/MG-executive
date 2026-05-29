import { useState, useRef } from 'react';
import { Upload, FileText } from 'lucide-react';
import { useTelemetry } from '../../../context/TelemetryContext.jsx';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import { parseStatusLogCsv } from '../../../utils/parseStatusLogCsv.js';
import IngestSummary from './IngestSummary.jsx';
import styles from './Importer.module.css';

export default function StatusLogImporter() {
  const { importEvents } = useTelemetry();
  const { scooters } = useMaintenance();
  const [defaultId, setDefaultId]   = useState('');
  const [progress, setProgress]     = useState(null);  // null | 0-100
  const [result, setResult]         = useState(null);
  const [_errors, setErrors]         = useState([]);
  const [dragging, setDragging]     = useState(false);
  const fileRef = useRef();

  // Build city map from existing scooters for city derivation at ingest
  const scooterCityMap = Object.fromEntries(
    scooters.map((s) => [s.scooterId, s.city || '']),
  );

  async function processFile(file) {
    if (!file) return;
    setResult(null);
    setErrors([]);
    setProgress(0);

    try {
      const text = await file.text();
      const { events, errors: parseErrors } = parseStatusLogCsv(
        text,
        defaultId.trim() || null,
        scooterCityMap,
      );

      setErrors(parseErrors);
      if (!events.length) {
        setProgress(null);
        setResult({
          written: 0,
          duplicates: 0,
          errors: parseErrors.length
            ? parseErrors
            : ['No events parsed from the file. Check column headers match expected format.'],
          label: 'Events',
        });
        return;
      }

      const { written, duplicates } = await importEvents(events, setProgress);
      setProgress(null);
      setResult({ written, duplicates, errors: parseErrors, label: 'Events' });
    } catch (err) {
      console.error('Status Log import failed:', err);
      setProgress(null);
      setResult({
        written: 0,
        duplicates: 0,
        errors: [`Upload failed: ${err.message || String(err)}`],
        label: 'Events',
      });
    }
  }

  function onFileChange(e) { processFile(e.target.files[0]); }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    processFile(e.dataTransfer.files[0]);
  }

  return (
    <div className={styles.importer}>
      <h3 className={styles.title}>
        <FileText size={15} /> Status Log CSV
      </h3>
      <p className={styles.desc}>
        Upload the platform's Status Log export — one file per scooter or combined.
        <br />
        Expected columns: <code>Time, User, Before State, After State, Reason, Location, Battery Level</code>
      </p>

      <label className={styles.idRow}>
        <span className={styles.idLabel}>Default Scooter ID <em>(leave blank if CSV has a "Scooter ID" column)</em></span>
        <input
          className={styles.idInput}
          value={defaultId}
          onChange={(e) => setDefaultId(e.target.value)}
          placeholder="e.g. 67411"
        />
      </label>

      <div
        className={`${styles.dropzone} ${dragging ? styles.dragging : ''}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <Upload size={20} />
        <span>Drop Status Log CSV here or <strong>click to browse</strong></span>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onFileChange} />
      </div>

      {progress !== null && (
        <div className={styles.progressWrap}>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${progress}%` }} />
          </div>
          <span className={styles.progressLabel}>{progress}%</span>
        </div>
      )}

      <IngestSummary result={result} />
    </div>
  );
}
