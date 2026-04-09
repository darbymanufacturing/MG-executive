import { useState, useRef } from 'react';
import Button from '../../Shared/Button.jsx';
import styles from './CsvImporter.module.css';

// ── Simple CSV parser (no external dependency) ────────────────────────────────
function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const nonEmpty = lines.filter((l) => l.trim() !== '');
  if (nonEmpty.length < 2) throw new Error('CSV must have a header row and at least one data row');

  const headers = nonEmpty[0]
    .split(',')
    .map((h) => h.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''));

  const rows = [];
  for (let i = 1; i < nonEmpty.length; i++) {
    const cells = splitCsvLine(nonEmpty[i]);
    if (cells.length === 0 || cells.every((c) => c === '')) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (cells[idx] ?? '').trim();
    });
    rows.push(obj);
  }
  return rows;
}

function splitCsvLine(line) {
  const result = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === ',' && !inQuote) {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

// ── Field mappers ─────────────────────────────────────────────────────────────
function mapTicketRow(row) {
  return {
    scooterId: row.scooter_id || row.scooterid || '',
    city: row.city || '',
    dateEntered: row.date_entered || row.dateentered || '',
    issueDescription: row.issue_description || row.issuedescription || '',
    category: row.category || '',
    status: row.status || '',
    primaryTag: row.primary_tag || row.primarytag || '',
    secondaryTag: row.secondary_tag || row.secondarytag || '',
    dateCompleted: row.date_completed || row.datecompleted || '',
    notes: row.notes || '',
  };
}

function mapPartRow(row) {
  return {
    sku: row.sku || '',
    partName: row.part_name || row.partname || '',
    unitCost: row.unit_cost || row.unitcost ? parseFloat(row.unit_cost || row.unitcost) : 0,
    leadTime: row.lead_time || row.leadtime ? parseInt(row.lead_time || row.leadtime, 10) : 0,
    stockOnHand: row.stock_on_hand || row.stockonhand
      ? parseInt(row.stock_on_hand || row.stockonhand, 10) : 0,
    reorderPoint: row.reorder_point || row.reorderpoint
      ? parseInt(row.reorder_point || row.reorderpoint, 10) : 0,
    unitsOnOrder: row.units_on_order || row.unitsonorder
      ? parseInt(row.units_on_order || row.unitsonorder, 10) : 0,
    orderDate: row.order_date || row.orderdate || '',
    eta: row.eta || '',
    supplier: row.supplier || '',
    status: row.status || '',
    notes: row.notes || '',
  };
}

const PREVIEW_LIMIT = 5;

export default function CsvImporter({ type, onImport }) {
  const fileRef = useRef(null);
  const [parsed, setParsed] = useState(null);   // { rows, headers }
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState('');

  const label = type === 'tickets' ? 'Repair Log' : 'Parts';

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setParsed(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rawRows = parseCsv(ev.target.result);
        const mapped = rawRows
          .map(type === 'tickets' ? mapTicketRow : mapPartRow)
          .filter(type === 'tickets'
            ? (r) => !!r.scooterId
            : (r) => !!r.sku
          );

        if (mapped.length === 0) {
          setError('No valid rows found. Ensure required fields are present (scooterId for tickets, sku for parts).');
          return;
        }

        const headers = Object.keys(mapped[0]);
        setParsed({ rows: mapped, headers });
      } catch (err) {
        setError(err.message || 'Failed to parse CSV');
      }
    };
    reader.onerror = () => setError('Failed to read file');
    reader.readAsText(file);

    // Reset input so same file can be re-selected
    e.target.value = '';
  }

  function handleConfirm() {
    if (!parsed) return;
    onImport(parsed.rows);
    setParsed(null);
    setFileName('');
  }

  function handleCancel() {
    setParsed(null);
    setFileName('');
    setError(null);
  }

  const previewRows = parsed?.rows.slice(0, PREVIEW_LIMIT) ?? [];
  const previewHeaders = parsed?.headers ?? [];

  return (
    <div className={styles.container}>
      <div className={styles.topRow}>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className={styles.hiddenInput}
          onChange={handleFileChange}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
        >
          Import {label} CSV
        </Button>
        {fileName && !parsed && (
          <span className={styles.fileName}>{fileName}</span>
        )}
      </div>

      {error && (
        <div className={styles.errorBox}>
          <strong>Parse error:</strong> {error}
        </div>
      )}

      {parsed && (
        <div className={styles.preview}>
          <div className={styles.previewHeader}>
            <span className={styles.previewTitle}>
              Preview — showing {previewRows.length} of {parsed.rows.length} rows
            </span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.previewTable}>
              <thead>
                <tr>
                  {previewHeaders.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr key={i}>
                    {previewHeaders.map((h) => (
                      <td key={h}>{String(row[h] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.actions}>
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleConfirm}>
              Confirm Import ({parsed.rows.length} row{parsed.rows.length !== 1 ? 's' : ''})
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
