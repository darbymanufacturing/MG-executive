/**
 * Scooters.jsx — /scooters roster page
 * Fleet list with filters; row click → /scooters/:id
 */

import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, AlertTriangle } from 'lucide-react';
import { useMaintenance } from '../context/MaintenanceContext.jsx';
import { useCosts } from '../context/CostContext.jsx';
import { useTelemetry } from '../context/TelemetryContext.jsx';
import { formatDate, formatEUR, formatRelativeTime } from '../utils/formatters.js';
import Header from '../components/Layout/Header.jsx';
import Button from '../components/Shared/Button.jsx';
import ScooterForm from '../components/Maintenance/fleet/ScooterForm.jsx';
import styles from './Scooters.module.css';

const STATUS_COLOR = {
  Active:      'var(--color-success)',
  'In Repair': 'var(--color-warning)',
  Retired:     'var(--color-text-muted)',
  Donor:       'var(--color-danger)',
};

export default function Scooters() {
  const navigate = useNavigate();
  const { scooters, tickets, addScooter, updateScooter } = useMaintenance();
  const { config } = useCosts();
  const { events } = useTelemetry();
  const cities = config?.locations?.length ? config.locations : ['Nafplion', 'Corinth'];

  const [cityF,   setCityF]   = useState('All');
  const [statusF, setStatusF] = useState('All');
  const [search,  setSearch]  = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing,  setEditing]  = useState(null);

  // Open ticket count per scooter
  const openTicketCount = useMemo(() => {
    const map = {};
    tickets.forEach((t) => {
      if (t.status === 'Completed' || t.status === 'Donor') return;
      const id = String(t.scooterId);
      map[id] = (map[id] || 0) + 1;
    });
    return map;
  }, [tickets]);

  // Latest event timestamp per scooter
  const lastSeen = useMemo(() => {
    const map = {};
    events.forEach((e) => {
      const id = e.scooterId;
      if (!map[id] || e.timestamp > map[id]) map[id] = e.timestamp;
    });
    return map;
  }, [events]);

  const filtered = useMemo(() => {
    return scooters.filter((s) => {
      if (cityF   !== 'All' && s.city   !== cityF)   return false;
      if (statusF !== 'All' && s.status !== statusF) return false;
      if (search  && !String(s.scooterId).includes(search) &&
          !s.model?.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [scooters, cityF, statusF, search]);

  // Summary counts
  const summary = useMemo(() => ({
    total:    scooters.length,
    active:   scooters.filter((s) => s.status === 'Active').length,
    inRepair: scooters.filter((s) => s.status === 'In Repair').length,
    retired:  scooters.filter((s) => s.status === 'Retired').length,
  }), [scooters]);

  async function handleSave(form) {
    if (editing) await updateScooter(editing._docId, form);
    else         await addScooter(form);
    setEditing(null);
    setFormOpen(false);
  }

  return (
    <div className={styles.page}>
      <Header title="Scooters" subtitle={`${summary.total} vehicles registered`} />

      {/* Summary bar */}
      <div className={styles.summaryBar}>
        <div className={styles.summaryItem}>
          <span className={styles.summaryVal}>{summary.total}</span>
          <span className={styles.summaryKey}>Total</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryVal} style={{ color: 'var(--color-success)' }}>{summary.active}</span>
          <span className={styles.summaryKey}>Active</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryVal} style={{ color: 'var(--color-warning)' }}>{summary.inRepair}</span>
          <span className={styles.summaryKey}>In Repair</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryVal} style={{ color: 'var(--color-text-muted)' }}>{summary.retired}</span>
          <span className={styles.summaryKey}>Retired</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <input
          className={styles.search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by ID or model…"
        />

        <div className={styles.chips}>
          {['All', ...cities].map((c) => (
            <button
              key={c}
              className={`${styles.chip} ${cityF === c ? styles.chipActive : ''}`}
              onClick={() => setCityF(c)}
            >{c}</button>
          ))}
        </div>

        <div className={styles.chips}>
          {['All', 'Active', 'In Repair', 'Retired', 'Donor'].map((s) => (
            <button
              key={s}
              className={`${styles.chip} ${statusF === s ? styles.chipActive : ''}`}
              onClick={() => setStatusF(s)}
            >{s}</button>
          ))}
        </div>

        <Button variant="primary" size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus size={14} /> Add Scooter
        </Button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className={styles.empty}>
          {scooters.length === 0
            ? 'No scooters registered yet. Click "Add Scooter" to get started.'
            : 'No scooters match the current filters.'}
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Scooter ID</th>
                <th>Model</th>
                <th>City</th>
                <th>Status</th>
                <th>Open Tickets</th>
                <th>Last Seen</th>
                <th>Purchase Date</th>
                <th>Price (€)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const openCount = openTicketCount[String(s.scooterId)] || 0;
                const ts        = lastSeen[s.scooterId];
                const statusColor = STATUS_COLOR[s.status] || 'var(--color-text-muted)';
                return (
                  <tr
                    key={s._docId}
                    className={styles.row}
                    onClick={() => navigate(`/scooters/${s.scooterId}`)}
                  >
                    <td className={styles.idCell}>#{s.scooterId}</td>
                    <td>{s.model || '—'}</td>
                    <td>{s.city || '—'}</td>
                    <td>
                      <span
                        className={styles.statusBadge}
                        style={{ background: `${statusColor}22`, color: statusColor }}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td>
                      {openCount > 0 ? (
                        <span className={styles.ticketCount}>
                          <AlertTriangle size={12} /> {openCount}
                        </span>
                      ) : '—'}
                    </td>
                    <td className={styles.muted}>{ts ? formatRelativeTime(ts) : '—'}</td>
                    <td>{formatDate(s.purchaseDate)}</td>
                    <td>{s.purchasePrice != null ? formatEUR(s.purchasePrice) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ScooterForm
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onSave={handleSave}
        initial={editing}
        cities={cities}
      />
    </div>
  );
}
