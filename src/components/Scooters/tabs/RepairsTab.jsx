/**
 * RepairsTab — ticket history for this scooter + "New Ticket" button.
 */

import { useState, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import { formatDate, formatEUR } from '../../../utils/formatters.js';
import Button from '../../Shared/Button.jsx';
import TicketForm from '../../Maintenance/tickets/TicketForm.jsx';
import styles from './Tab.module.css';

export default function RepairsTab({ scooterId }) {
  const { tickets, addTicket, updateTicket } = useMaintenance();

  const [showForm,  setShowForm]  = useState(false);
  const [editing,   setEditing]   = useState(null);

  const myTickets = useMemo(() =>
    tickets
      .filter((t) => String(t.scooterId) === String(scooterId))
      .sort((a, b) => (b.dateEntered || '').localeCompare(a.dateEntered || '')),
  [tickets, scooterId]);

  async function handleSave(form) {
    // Pre-fill scooterId
    const data = { ...form, scooterId };
    if (editing) await updateTicket(editing._docId, data);
    else         await addTicket(data);
    setEditing(null);
    setShowForm(false);
  }

  return (
    <div className={styles.tab}>
      <div className={styles.section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
          <h3 className={styles.sectionTitle} style={{ margin: 0 }}>
            Repair History ({myTickets.length})
          </h3>
          <Button variant="primary" size="sm" onClick={() => { setEditing(null); setShowForm(true); }}>
            <Plus size={13} /> New Ticket
          </Button>
        </div>

        {myTickets.length === 0 ? (
          <p className={styles.emptyText}>No repair tickets for this scooter.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Days Down</th>
                  <th>Parts Cost</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {myTickets.map((t) => (
                  <tr key={t._docId}>
                    <td>{formatDate(t.dateEntered)}</td>
                    <td>{t.category || '—'}</td>
                    <td>
                      <span className={`${styles.statusBadge} ${t.status === 'Completed' ? styles.completed : styles.active}`}>
                        {t.status}
                      </span>
                    </td>
                    <td>{t.daysOpen ?? '—'}</td>
                    <td className={styles.warning}>
                      {t.partsUsed?.length
                        ? formatEUR(t.partsUsed.reduce((s, p) => s + (p.quantity || 0) * (p.unitCost || 0), 0))
                        : '—'}
                    </td>
                    <td>
                      <button
                        className={styles.linkBtn}
                        onClick={() => { setEditing(t); setShowForm(true); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: 'var(--text-xs, 11px)', fontWeight: 600 }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <TicketForm
          isOpen={showForm}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSave={handleSave}
          initialData={editing || { scooterId }}
          isAtMaxActive={false}
        />
      )}
    </div>
  );
}
