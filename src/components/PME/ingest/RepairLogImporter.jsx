import { useState, useRef, useCallback } from 'react';
import { Upload, FileText } from 'lucide-react';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import { parseRepairLogCsv } from '../../../utils/parseRepairLogCsv.js';
import { db } from '../../../lib/firebase.js';
import { writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import IngestSummary from './IngestSummary.jsx';
import styles from './Importer.module.css';

const BATCH_SIZE  = 450;
const TICKETS_COL = 'maintenanceTickets';

export default function RepairLogImporter() {
  const { tickets } = useMaintenance();
  const [defaultId, setDefaultId] = useState('');
  const [progress, setProgress]   = useState(null);
  const [result, setResult]       = useState(null);
  const [dragging, setDragging]   = useState(false);
  const fileRef = useRef();

  const existingIds = new Set(tickets.map((t) => t._docId));

  const importTickets = useCallback(async (parsedTickets, onProgress) => {
    const newRows    = parsedTickets.filter((t) => !existingIds.has(t._docId));
    const duplicates = parsedTickets.length - newRows.length;
    let written = 0;

    for (let i = 0; i < newRows.length; i += BATCH_SIZE) {
      const chunk = newRows.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach(({ _docId, ...data }) => {
        batch.set(doc(db, TICKETS_COL, _docId), {
          ...data,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      written += chunk.length;
      if (onProgress) onProgress(Math.round((written / newRows.length) * 100));
    }

    return { written, duplicates };
  }, [existingIds]);

  async function processFile(file) {
    if (!file) return;
    setResult(null);
    setProgress(0);

    const text = await file.text();
    const { tickets: parsed, errors, total } = parseRepairLogCsv(
      text,
      defaultId.trim() || null,
    );

    if (!parsed.length) {
      setProgress(null);
      setResult({ written: 0, duplicates: 0, errors, label: 'Repairs' });
      return;
    }

    const { written, duplicates } = await importTickets(parsed, setProgress);
    setProgress(null);
    setResult({ written, duplicates, errors, label: 'Repairs' });
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
