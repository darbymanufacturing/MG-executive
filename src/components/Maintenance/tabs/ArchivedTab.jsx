import { useState, useMemo } from 'react';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import TicketTable from '../tickets/TicketTable.jsx';
import TicketForm from '../tickets/TicketForm.jsx';
import styles from './RepairLogTab.module.css';

const ARCHIVED_STATUSES = ['Completed', 'Donor'];

export default function ArchivedTab({ filteredTickets }) {
  const { updateTicket } = useMaintenance();
  const [search, setSearch]           = useState('');
  const [editingTicket, setEditingTicket] = useState(null);
  const [showForm,      setShowForm]      = useState(false);

  const archived = useMemo(() => {
    let result = filteredTickets.filter((t) => ARCHIVED_STATUSES.includes(t.status));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (t) =>
          (t.scooterId ?? '').toLowerCase().includes(q) ||
          (t.issueDescription ?? '').toLowerCase().includes(q),
      );
    }
    return result;
  }, [filteredTickets, search]);

  async function handleSave(data) {
    if (editingTicket) await updateTicket(editingTicket._docId, data);
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar} style={{ marginBottom: 8 }}>
        <input
          type="text"
          style={{
            flex: 1,
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-body)',
            fontSize: '0.875rem',
            padding: '7px 12px',
            outline: 'none',
          }}
          placeholder="Search scooter ID or issue…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className={styles.count}>
          {archived.length} archived ticket{archived.length !== 1 ? 's' : ''}
        </span>
      </div>

      <TicketTable
        tickets={archived}
        onEdit={(ticket) => { setEditingTicket(ticket); setShowForm(true); }}
        onComplete={() => {}}
        hideDelete
      />

      <TicketForm
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        onSave={handleSave}
        initialData={editingTicket}
        isAtMaxActive={false}
      />
    </div>
  );
}
