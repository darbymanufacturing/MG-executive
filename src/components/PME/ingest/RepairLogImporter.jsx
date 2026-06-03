import { useState, useRef } from 'react';
import { Upload, FileText } from 'lucide-react';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import { parseRepairLogCsv } from '../../../utils/parseRepairLogCsv.js';
import IngestSummary from './IngestSummary.jsx';
import styles from './Importer.module.css';

export default function RepairLogImporter() {
  const { tickets, importTickets } = useMaintenance();
  const [defaultId, setDefaultId] = useState('');
  const [loading, setLoading]     = useState(false);
  const [result, setResult]       = useState(null);
  const [dragging, setDragging]   = useState(false);
  const fileRef = useRef();

  async function processFile(file) {
    if (!file) return;
    setResult(null);
    setLoading(true);

    const text = await file.text();
    const { tickets: parsed, errors, total: _total } = parseRepairLogCsv(
      text,
      defaultId.trim() || null,
    );

    if (!parsed.length) {
      setLoading(false);
      setResult({ written: 0, duplicates: 0, errors, label: 'Repairs' });
      return;
    }

    // Compute duplicates before the call using the ids already in context.
    const existingIds = new Set(tickets.map((t) => t._docId));
    const duplicates = parsed.filter((t) => existingIds.has(t._docId)).length;

    await importTickets(parsed);
    setLoading(false);
    setResult({ written: parsed.length - duplicates, duplicates, errors, label: 'Repairs' });
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
        <FileText size={15} /> Repair Log CSV
      </h3>
      <p className={styles.desc}>
        Upload the platform's Repair Log export. Rows merge into the existing Maintenance ticket log.
        <br />
        Expected columns: <code>Issue Type, Issue Tags, Real Issue, Comment, Parts used, Created, Fixed, Fixed By</code>
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
        <span>Drop Repair Log CSV here or <strong>click to browse</strong></span>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onFileChange} />
      </div>

      {loading && (
        <div className={styles.progressWrap}>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: '100%', opacity: 0.5 }} />
          </div>
          <span className={styles.progressLabel}>Importing…</span>
        </div>
      )}

      <IngestSummary result={result} />
    </div>
  );
}
