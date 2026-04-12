import { useState } from 'react';
import { ChevronDown, ChevronUp, Edit2, Trash2, Clock } from 'lucide-react';
import { useDiary } from '../../context/DiaryContext.jsx';
import styles from './DiaryEntry.module.css';

const MODULE_LABELS = {
  cost: 'Cost', revenue: 'Revenue', scooter: 'Scooter',
  ticket: 'Ticket', part: 'Part', project: 'Project',
  milestone: 'Milestone', blocker: 'Blocker', update: 'Update', gate: 'Gate',
};

const STATUS_COLORS = {
  applied: '#22c55e', partial: '#f59e0b', pending: '#C97D49', rejected: '#ef4444',
};

function formatDate(ts) {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function DiaryEntry({ entry, onEdit }) {
  const [expanded, setExpanded] = useState(false);
  const { deleteEntry } = useDiary();

  const modules = [...new Set((entry.actions || []).map((a) => a.module))];
  const statusColor = STATUS_COLORS[entry.status] || '#888';

  return (
    <div className={styles.card}>
      {/* Header row */}
      <div className={styles.header} onClick={() => setExpanded((v) => !v)}>
        <span className={styles.dot} style={{ background: statusColor }} />
        <div className={styles.meta}>
          <span className={styles.summary}>{entry.summary}</span>
          <span className={styles.date}>{formatDate(entry.createdAt)}</span>
        </div>
        <div className={styles.chips}>
          {modules.slice(0, 3).map((m) => (
            <span key={m} className={styles.chip}>{MODULE_LABELS[m] || m}</span>
          ))}
          {modules.length > 3 && <span className={styles.chip}>+{modules.length - 3}</span>}
        </div>
        <button className={styles.chevron} aria-label="expand">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className={styles.body}>
          {/* Raw text */}
          <div className={styles.rawText}>"{entry.rawText}"</div>

          {/* Actions list */}
          {entry.actions?.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>Actions</div>
              <ul className={styles.actionList}>
                {entry.actions.map((a, i) => (
                  <li key={i} className={styles.actionItem}>
                    <span className={`${styles.opBadge} ${styles[`op_${a.operation}`]}`}>{a.operation}</span>
                    <span className={styles.actionModule}>{MODULE_LABELS[a.module] || a.module}</span>
                    <span className={styles.actionData}>
                      {a.data?.name || a.data?.scooterId || a.data?.title || a.data?.text || ''}
                    </span>
                    {a.executed && <span className={styles.executed}>✓</span>}
                    {a.error && <span className={styles.errorText}>{a.error}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Unresolved */}
          {entry.unresolved?.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>Notes / Assumptions</div>
              <ul className={styles.unresolvedList}>
                {entry.unresolved.map((u, i) => (
                  <li key={i} className={styles.unresolvedItem}>{u}</li>
                ))}
              </ul>
            </div>
          )}

          {/* History */}
          {entry.history?.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}><Clock size={11} /> Edit history ({entry.history.length})</div>
              {entry.history.map((h, i) => (
                <div key={i} className={styles.historyItem}>
                  <span className={styles.historyDate}>{h.editedAt?.slice(0, 10)}</span>
                  <span className={styles.historyPrev}>{h.previousSummary}</span>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className={styles.footer}>
            <button className={styles.editBtn} onClick={() => onEdit(entry)}>
              <Edit2 size={12} /> Edit
            </button>
            <button className={styles.deleteBtn} onClick={() => deleteEntry(entry._docId)}>
              <Trash2 size={12} /> Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
