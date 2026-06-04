import { useState, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import { useOrgCollection } from '../../../hooks/useOrgCollection.js';
import Button from '../../Shared/Button.jsx';
import ActiveTicketsBanner from '../tickets/ActiveTicketsBanner.jsx';
import TicketFilters from '../tickets/TicketFilters.jsx';
import TicketTable from '../tickets/TicketTable.jsx';
import TicketForm from '../tickets/TicketForm.jsx';
import Skeleton from '../../Shared/Skeleton.jsx';
import styles from './RepairLogTab.module.css';

const ARCHIVED_STATUSES = ['Completed', 'Donor'];
const EMPTY_FILTERS = { search: '', statuses: [], categories: [], tags: [] };

export default function RepairLogTab({ filteredTickets }) {
  const {
    config, isAtMaxActive, activeCount, loading,
    addTicket, updateTicket, deleteTicket, completeTicket, assignTicket,
  } = useMaintenance();
  const [filters,       setFilters]       = useState(EMPTY_FILTERS);
  const [showForm,      setShowForm]      = useState(false);
  const [editingTicket, setEditingTicket] = useState(null);

  // ADR-0023: useOrgCollection auto-scopes by orgId; role lives in data jsonb,
  // NOT a column → fetch all org users then filter to technician/crew in JS.
  // #165: include 'crew' role — crew members can be assigned to tickets.
  // #401: org-isolation enforced by useOrgCollection (RLS + orgId auto-filter).
  const TECH_ROLES = new Set(['technician', 'crew']);
  const { items: orgUsers } = useOrgCollection('users', {});
  const technicians = useMemo(
    () => orgUsers
      .filter((u) => TECH_ROLES.has(u.role))
      .map((u) => ({ uid: u._docId, ...u })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orgUsers],
  );

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

      {loading ? (
        <div style={{ padding: 'var(--space-4)' }}>
          <Skeleton variant="text" lines={6} height="44px" />
        </div>
      ) : (
        <TicketTable
          tickets={displayTickets}
          onEdit={handleOpenEdit}
          onDelete={handleDelete}
          onComplete={handleComplete}
          technicians={technicians}
          onAssign={handleAssign}
        />
      )}

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
