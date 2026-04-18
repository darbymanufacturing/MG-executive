import { useState, useMemo, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../../lib/firebase.js';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import Button from '../../Shared/Button.jsx';
import ActiveTicketsBanner from '../tickets/ActiveTicketsBanner.jsx';
import TicketFilters from '../tickets/TicketFilters.jsx';
import TicketTable from '../tickets/TicketTable.jsx';
import TicketForm from '../tickets/TicketForm.jsx';
import styles from './RepairLogTab.module.css';

const ARCHIVED_STATUSES = ['Completed', 'Donor'];
const EMPTY_FILTERS = { search: '', statuses: [], categories: [], tags: [] };

export default function RepairLogTab({ filteredTickets }) {
  const {
    config, isAtMaxActive, activeCount,
    addTicket, updateTicket, deleteTicket, completeTicket, assignTicket,
  } = useMaintenance();

  const [filters,       setFilters]       = useState(EMPTY_FILTERS);
  const [showForm,      setShowForm]      = useState(false);
  const [editingTicket, setEditingTicket] = useState(null);
  const [technicians,   setTechnicians]   = useState([]);

  useEffect(() => {
    const q = query(collection(db, 'users'), where('role', '==', 'technician'));
    return onSnapshot(q, (snap) => {
      setTechnicians(snap.docs.map((d) => ({ uid: d.id, ...d.data() })));
    });
  }, []);

  function handleSearch(val) {
    setFilters((prev) => ({ ...prev, search: val }));
  }

  function handleToggle(key, value) {
    setFilters((prev) => {
      const current = prev[key] || [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [key]: next };
    });
  }

  function handleClearFilters() {
    setFilters(EMPTY_FILTERS);
  }

  const displayTickets = useMemo(() => {
    // Exclude archived tickets — those live in the Archived tab
    let result = filteredTickets.filter((t) => !ARCHIVED_STATUSES.includes(t.status));

    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      result = result.filter(
        (t) =>
          (t.scooterId ?? '').toLowerCase().includes(q) ||
          (t.issueDescription ?? '').toLowerCase().includes(q),
      );
    }

    if (filters.statuses.length > 0) {
      result = result.filter((t) => filters.statuses.includes(t.status));
    }

    if (filters.categories.length > 0) {
      result = result.filter((t) => filters.categories.includes(t.category));
    }

    if (filters.tags.length > 0) {
      result = result.filter((t) => {
        const ticketTags = (t.primaryTag || '').split(',').map((s) => s.trim());
        return filters.tags.some((tag) => ticketTags.includes(tag));
      });
    }

    return result;
  }, [filteredTickets, filters]);

  function handleOpenAdd() {
    setEditingTicket(null);
    setShowForm(true);
  }

  function handleOpenEdit(ticket) {
    setEditingTicket(ticket);
    setShowForm(true);
  }

  async function handleSave(data) {
    if (editingTicket) {
      await updateTicket(editingTicket._docId, data);
    } else {
      await addTicket(data);
    }
  }

  async function handleDelete(docId) {
    await deleteTicket(docId);
  }

  async function handleComplete(docId) {
    await completeTicket(docId);
  }

  async function handleAssign(docId, uid) {
    const tech = technicians.find((t) => t.uid === uid);
    await assignTicket(docId, uid || null, tech?.displayName || null);
  }

  return (
    <div className={styles.wrapper}>
      {isAtMaxActive && (
        <ActiveTicketsBanner
          activeCount={activeCount}
          maxActiveTickets={config.maxActiveTickets ?? 3}
        />
      )}

      <TicketFilters
        filters={filters}
        onSearch={handleSearch}
        onToggle={handleToggle}
        onClear={handleClearFilters}
      />

      <div className={styles.toolbar}>
        <span className={styles.count}>
          {displayTickets.length} ticket{displayTickets.length !== 1 ? 's' : ''}
        </span>
        <Button variant="primary" size="sm" onClick={handleOpenAdd}>
          <Plus size={14} />
          Add Ticket
        </Button>
      </div>

      <TicketTable
        tickets={displayTickets}
        onEdit={handleOpenEdit}
        onDelete={handleDelete}
        onComplete={handleComplete}
        technicians={technicians}
        onAssign={handleAssign}
      />

      <TicketForm
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        onSave={handleSave}
        initialData={editingTicket}
        isAtMaxActive={isAtMaxActive}
      />
    </div>
  );
}
