import { useState, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import Button from '../../Shared/Button.jsx';
import ActiveTicketsBanner from '../tickets/ActiveTicketsBanner.jsx';
import TicketFilters from '../tickets/TicketFilters.jsx';
import TicketTable from '../tickets/TicketTable.jsx';
import TicketForm from '../tickets/TicketForm.jsx';
import styles from './RepairLogTab.module.css';

const EMPTY_FILTERS = { search: '', status: '', category: '', tag: '' };

export default function RepairLogTab({ filteredTickets }) {
  const {
    config, isAtMaxActive, activeCount,
    addTicket, updateTicket, deleteTicket, completeTicket,
  } = useMaintenance();

  const [filters,       setFilters]       = useState(EMPTY_FILTERS);
  const [showForm,      setShowForm]      = useState(false);
  const [editingTicket, setEditingTicket] = useState(null);

  function handleFilterChange(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function handleClearFilters() {
    setFilters(EMPTY_FILTERS);
  }

  const displayTickets = useMemo(() => {
    let result = filteredTickets;

    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      result = result.filter(
        (t) =>
          (t.scooterId ?? '').toLowerCase().includes(q) ||
          (t.issueDescription ?? '').toLowerCase().includes(q),
      );
    }

    if (filters.status) {
      result = result.filter((t) => t.status === filters.status);
    }

    if (filters.category) {
      result = result.filter((t) => t.category === filters.category);
    }

    if (filters.tag) {
      result = result.filter((t) =>
        (t.primaryTag || '').split(',').map((s) => s.trim()).includes(filters.tag),
      );
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
        onChange={handleFilterChange}
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
