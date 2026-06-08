/**
 * DetailsTab — scooter metadata + derived live state.
 * Shows everything stored in the scooters Firestore doc.
 */

import { useMemo } from 'react';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import { useTelemetry } from '../../../context/TelemetryContext.jsx';
import { formatDate, formatEUR, formatRelativeTime } from '../../../utils/formatters.js';
import styles from './Tab.module.css';

const STATUS_COLOR = {
  Active:      'var(--color-success)',
  'In Repair': 'var(--color-warning)',
  'To be Repainted': 'var(--accent)',
  Retired:     'var(--color-text-muted)',
  Donor:       'var(--color-danger)',
};

function Field({ label, value }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.fieldValue}>{value || '—'}</span>
    </div>
  );
}

export default function DetailsTab({ scooter }) {
  const { tickets } = useMaintenance();
  const { events }  = useTelemetry();

  const openTickets = useMemo(() =>
    tickets.filter((t) => String(t.scooterId) === String(scooter.scooterId) &&
      t.status !== 'Completed' && t.status !== 'Donor'),
  [tickets, scooter.scooterId]);

  const latestEvent = useMemo(() =>
    events
      .filter((e) => e.scooterId === scooter.scooterId)
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))[0],
  [events, scooter.scooterId]);

  const statusColor = STATUS_COLOR[scooter.status] || 'var(--color-text-muted)';

  return (
    <div className={styles.tab}>
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Fleet Info</h3>
        <div className={styles.grid}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Status</span>
            <span className={styles.fieldValue}>
              <span style={{
                display: 'inline-block',
                padding: '2px 10px',
                borderRadius: 999,
                background: `${statusColor}22`,
                color: statusColor,
                fontWeight: 600,
                fontSize: 'var(--text-sm)',
              }}>
                {scooter.status || '—'}
              </span>
            </span>
          </div>
          <Field label="Scooter ID"     value={scooter.scooterId} />
          <Field label="Model"          value={scooter.model} />
          <Field label="City"           value={scooter.city} />
          <Field label="Purchase Date"  value={formatDate(scooter.purchaseDate)} />
          <Field label="Purchase Price" value={scooter.purchasePrice != null ? formatEUR(scooter.purchasePrice) : null} />
          <Field label="Notes"          value={scooter.notes} />
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Live State</h3>
        <div className={styles.grid}>
          <Field label="Open Tickets"   value={openTickets.length > 0 ? `${openTickets.length} open` : '0 open'} />
          <Field label="Last Telemetry" value={latestEvent ? formatRelativeTime(latestEvent.timestamp) : 'No data'} />
          <Field label="Last Event"     value={latestEvent?.eventType || '—'} />
        </div>
      </div>

      {openTickets.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Open Tickets</h3>
          <div className={styles.ticketList}>
            {openTickets.map((t) => (
              <div key={t._docId} className={styles.ticketRow}>
                <span className={styles.ticketCat}>{t.category || 'Uncategorized'}</span>
                <span className={styles.ticketDate}>{formatDate(t.dateEntered)}</span>
                <span className={`${styles.ticketStatus} ${t.status === 'In Progress' ? styles.inProgress : styles.open}`}>
                  {t.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
