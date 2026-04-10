import { useState } from 'react';
import { Pencil, CheckSquare, Trash2, ClipboardX } from 'lucide-react';
import ConfirmDialog from '../../Shared/ConfirmDialog.jsx';
import styles from './TicketTable.module.css';

const STATUS_COLORS = {
  Active:        '#0ea5e9',
  Backlog:       '#888',
  Investigation: '#FF9800',
  Blocked:       '#F44336',
  Donor:         '#8E24AA',
  Completed:     '#4CAF50',
};

const CATEGORIES = { Q: 'Quick', M: 'Medium/Est.', C: 'Complex', B: 'Blocked', F: 'Finished' };

function truncate(str, max = 40) {
  if (!str) return '—';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function StatusBadge({ status }) {
  const color = STATUS_COLORS[status] ?? '#888';
  return (
    <span
      className={styles.statusBadge}
      style={{ background: `${color}22`, color, borderColor: `${color}44` }}
    >
      {status}
    </span>
  );
}

function CategoryBadge({ code }) {
  return (
    <span className={styles.categoryBadge} title={CATEGORIES[code]}>
      {code}
    </span>
  );
}

export default function TicketTable({ tickets, onEdit, onDelete, onComplete }) {
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { docId, scooterId }

  if (tickets.length === 0) {
    return (
      <div className={styles.empty}>
        <ClipboardX size={32} className={styles.emptyIcon} />
        <p className={styles.emptyText}>No tickets match the current filters.</p>
      </div>
    );
  }

  return (
    <>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Scooter ID</th>
              <th className={styles.th}>City</th>
              <th className={styles.th}>Date</th>
              <th className={styles.th}>Issue</th>
              <th className={styles.th}>Cat.</th>
              <th className={styles.th}>Status</th>
              <th className={styles.th}>Tag</th>
              <th className={styles.th + ' ' + styles.thNum}>Days</th>
              <th className={styles.th + ' ' + styles.thNum}>Rev. Lost</th>
              <th className={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => (
              <tr key={ticket._docId} className={styles.row}>
                <td className={styles.td}>
                  <span className={styles.scooterId}>{ticket.scooterId ?? '—'}</span>
                </td>
                <td className={styles.td}>
                  <span className={styles.city}>{ticket.city ?? '—'}</span>
                </td>
                <td className={styles.td}>
                  <span className={styles.date}>{ticket.dateEntered ?? '—'}</span>
                </td>
                <td className={styles.td}>
                  <span className={styles.issue} title={ticket.issueDescription}>
                    {truncate(ticket.issueDescription, 40)}
                  </span>
                </td>
                <td className={styles.td}>
                  <CategoryBadge code={ticket.category} />
                </td>
                <td className={styles.td}>
                  <StatusBadge status={ticket.status} />
                </td>
                <td className={styles.td}>
                  <span className={styles.tag}>{ticket.primaryTag ?? '—'}</span>
                </td>
                <td className={`${styles.td} ${styles.tdNum}`}>
                  <span className={styles.daysOpen}>{ticket.daysOpen ?? 0}</span>
                </td>
                <td className={`${styles.td} ${styles.tdNum}`}>
                  <span className={styles.revenueLost}>
                    €{(ticket.revenueLost ?? 0).toFixed(0)}
                  </span>
                </td>
                <td className={styles.td}>
                  <div className={styles.actions}>
                    <button
                      className={styles.actionBtn}
                      title="Edit"
                      onClick={() => onEdit(ticket)}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className={`${styles.actionBtn} ${styles.actionComplete}`}
                      title="Mark Completed"
                      disabled={ticket.status === 'Completed'}
                      onClick={() => onComplete(ticket._docId)}
                    >
                      <CheckSquare size={14} />
                    </button>
                    <button
                      className={`${styles.actionBtn} ${styles.actionDelete}`}
                      title="Delete"
                      onClick={() => setDeleteConfirm({ docId: ticket._docId, scooterId: ticket.scooterId })}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm) onDelete(deleteConfirm.docId);
          setDeleteConfirm(null);
        }}
        title="Delete Ticket"
        message={`Permanently delete ticket for scooter "${deleteConfirm?.scooterId ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete Ticket"
      />
    </>
  );
}
