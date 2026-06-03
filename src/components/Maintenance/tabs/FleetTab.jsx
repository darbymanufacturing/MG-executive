import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, AlertTriangle, FileX, FileCheck } from 'lucide-react';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import { useTelemetrySafe } from '../../../context/TelemetryContext.jsx';
import { useCosts } from '../../../context/CostContext.jsx';
import ScooterForm from '../fleet/ScooterForm.jsx';
import ConfirmDialog from '../../Shared/ConfirmDialog.jsx';
import Button from '../../Shared/Button.jsx';
import styles from './FleetTab.module.css';

const STATUS_COLOR = {
  Active:     '#22c55e',
  'In Repair':'#f59e0b',
  Retired:    '#6b7280',
  Donor:      '#ef4444',
};

export default function FleetTab() {
  const navigate = useNavigate();
  const { scooters, tickets, addScooter, updateScooter, deleteScooter } = useMaintenance();
  // #376 — useTelemetrySafe: /maintenance is outside ScooterScopedRoutes, so TelemetryProvider
  // is not mounted here. The safe shim returns empty events → "No CSV" for all scooters.
  const { events: telemetryEvents } = useTelemetrySafe();
  const { config } = useCosts();
  const cities = config.locations?.length ? config.locations : ['Nafplio', 'Corinth'];

  const [formOpen, setFormOpen]   = useState(false);
  const [editing, setEditing]     = useState(null);
  const [deleting, setDeleting]   = useState(null);
  const [cityF, setCityF]         = useState('All');
  const [statusF, setStatusF]     = useState('All');
  const [search, setSearch]       = useState('');
  const [noCsvOnly, setNoCsvOnly] = useState(false);

  // Open tickets per scooter (active, not completed/donor)
  const openTicketCount = useMemo(() => {
    const map = {};
    tickets.forEach((t) => {
      if (t.status === 'Completed' || t.status === 'Donor') return;
      const id = String(t.scooterId);
      map[id] = (map[id] || 0) + 1;
    });
    return map;
  }, [tickets]);

  // Scooter IDs that have at least one telemetry event (Status Log CSV uploaded)
  const scootersWithData = useMemo(() => {
    const s = new Set();
    telemetryEvents.forEach((ev) => { if (ev.scooterId) s.add(String(ev.scooterId)); });
    return s;
  }, [telemetryEvents]);

  const filtered = useMemo(() => {
    return scooters.filter((s) => {
      if (cityF   !== 'All' && s.city   !== cityF)   return false;
      if (statusF !== 'All' && s.status !== statusF) return false;
      if (noCsvOnly && scootersWithData.has(String(s.scooterId))) return false;
      if (search && !String(s.scooterId).includes(search) &&
          !s.model?.toLowerCase().includes(search.toLowerCase()) &&
          !s.notes?.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [scooters, cityF, statusF, search, noCsvOnly, scootersWithData]);

  // Summary counts
  const summary = useMemo(() => ({
    total:    scooters.length,
    active:   scooters.filter((s) => s.status === 'Active').length,
    inRepair: scooters.filter((s) => s.status === 'In Repair').length,
    retired:  scooters.filter((s) => s.status === 'Retired').length,
    donor:    scooters.filter((s) => s.status === 'Donor').length,
    noCsv:    scooters.filter((s) => !scootersWithData.has(String(s.scooterId))).length,
  }), [scooters, scootersWithData]);

  async function handleSave(form) {
    if (editing) await updateScooter(editing._docId, form);
    else         await addScooter(form);
    setEditing(null);
  }

  function openEdit(s) { setEditing(s); setFormOpen(true); }
  function openNew()   { setEditing(null); setFormOpen(true); }

  return (
    <div className={styles.wrap}>
      {/* Summary bar */}
      <div className={styles.summaryBar}>
        <div className={styles.summaryItem}>
          <span className={styles.summaryVal}>{summary.total}</span>
          <span className={styles.summaryKey}>Total</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryVal} style={{ color: '#22c55e' }}>{summary.active}</span>
          <span className={styles.summaryKey}>Active</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryVal} style={{ color: '#f59e0b' }}>{summary.inRepair}</span>
          <span className={styles.summaryKey}>In Repair</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryVal} style={{ color: '#6b7280' }}>{summary.retired}</span>
          <span className={styles.summaryKey}>Retired</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryVal} style={{ color: '#ef4444' }}>{summary.donor}</span>
          <span className={styles.summaryKey}>Donor</span>
        </div>
        <div className={styles.summaryDivider} />
        <div
          className={styles.summaryItem}
          style={{ cursor: summary.noCsv > 0 ? 'pointer' : 'default' }}
          onClick={() => summary.noCsv > 0 && setNoCsvOnly((v) => !v)}
          title={summary.noCsv > 0 ? 'Click to filter to scooters missing CSV data' : undefined}
        >
          <span className={styles.summaryVal} style={{ color: summary.noCsv > 0 ? '#f59e0b' : '#22c55e' }}>
            {summary.noCsv}
          </span>
          <span className={styles.summaryKey}>No CSV</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <input
          className={styles.search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by ID, model…"
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
          <button
            className={`${styles.chip} ${noCsvOnly ? styles.chipWarn : ''}`}
            onClick={() => setNoCsvOnly((v) => !v)}
            title="Show only scooters with no Status Log CSV uploaded"
          >
            <FileX size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} />
            No CSV
            {summary.noCsv > 0 && <span className={styles.chipCount}>{summary.noCsv}</span>}
          </button>
        </div>

        <Button variant="primary" size="sm" onClick={openNew}>
          <Plus size={14} /> Add Scooter
        </Button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className={styles.empty}>
          {scooters.length === 0
            ? 'No scooters registered yet. Click "Add Scooter" to build your fleet inventory.'
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
                <th>Telemetry</th>
                <th>Open Tickets</th>
                <th>Purchase Date</th>
                <th>Price (€)</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const openCount = openTicketCount[String(s.scooterId)] || 0;
                const hasData   = scootersWithData.has(String(s.scooterId));
                return (
                  <tr
                    key={s._docId}
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/scooters/${s.scooterId}`)}
                  >
                    <td className={styles.idCell}>{s.scooterId}</td>
                    <td className={styles.modelCell}>{s.model}</td>
                    <td>{s.city || '—'}</td>
                    <td>
                      <span
                        className={styles.statusBadge}
                        style={{ background: `${STATUS_COLOR[s.status]}22`, color: STATUS_COLOR[s.status] }}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td>
                      {hasData ? (
                        <span className={styles.dataOkBadge}>
                          <FileCheck size={11} /> Loaded
                        </span>
                      ) : (
                        <span className={styles.noDataBadge}>
                          <FileX size={11} /> No CSV
                        </span>
                      )}
                    </td>
                    <td>
                      {openCount > 0 ? (
                        <span className={styles.ticketCount}>
                          <AlertTriangle size={12} /> {openCount}
                        </span>
                      ) : (
                        <span className={styles.ticketNone}>—</span>
                      )}
                    </td>
                    <td>{s.purchaseDate || '—'}</td>
                    <td>{s.purchasePrice != null ? `€${Number(s.purchasePrice).toLocaleString()}` : '—'}</td>
                    <td className={styles.notesCell}>{s.notes || '—'}</td>
                    <td className={styles.actionsCell} onClick={(e) => e.stopPropagation()}>
                      <button className={styles.iconBtn} onClick={() => openEdit(s)} title="Edit">
                        <Pencil size={13} />
                      </button>
                      <button className={styles.iconBtn} onClick={() => setDeleting(s._docId)} title="Delete">
                        <Trash2 size={13} />
                      </button>
                    </td>
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

      <ConfirmDialog
        isOpen={!!deleting}
        onClose={() => setDeleting(null)}
        title="Remove Scooter"
        message="This removes the scooter from the fleet registry. Maintenance tickets linked to this ID are not deleted."
        confirmLabel="Remove"
        onConfirm={async () => { await deleteScooter(deleting); setDeleting(null); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
