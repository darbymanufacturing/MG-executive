/**
 * TripsTab — trip history for a single scooter.
 * Includes inline TripImporter (drag-drop CSV) and a summary + table view.
 */

import { useMemo, useState } from 'react';
import { Upload, Trash2 } from 'lucide-react';
import { useTrips } from '../../../context/TripContext.jsx';
import { formatDate, formatKm, formatMinutes, formatEUR } from '../../../utils/formatters.js';
import TripImporter from '../TripImporter.jsx';
import Button from '../../Shared/Button.jsx';
import ConfirmDialog from '../../Shared/ConfirmDialog.jsx';
import styles from './Tab.module.css';

export default function TripsTab({ scooterId }) {
  const { trips, loading, clearTripsForScooter } = useTrips();
  const [showImporter, setShowImporter] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);

  const myTrips = useMemo(() =>
    trips
      .filter((t) => String(t.scooterId) === String(scooterId))
      .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || '')),
  [trips, scooterId]);

  if (loading) {
    return <div className={styles.empty}><p className={styles.emptyText}>Loading trips…</p></div>;
  }

  // Empty state — show importer directly
  if (myTrips.length === 0 && !showImporter) {
    return (
      <div className={styles.tab}>
        <TripImporter
          scooterId={scooterId}
          onImportDone={() => setShowImporter(false)}
        />
      </div>
    );
  }

  const totalDist = myTrips.reduce((s, t) => s + (t.distanceKm || 0), 0);
  const totalMin  = myTrips.reduce((s, t) => s + (t.durationMinutes || 0), 0);
  const totalRev  = myTrips.reduce((s, t) => s + (t.cost || 0), 0);

  return (
    <div className={styles.tab}>
      {/* Importer panel (shown when button clicked) */}
      {showImporter && (
        <div className={styles.section}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
            <h3 className={styles.sectionTitle} style={{ margin: 0 }}>Import Trip CSV</h3>
            <button
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}
              onClick={() => setShowImporter(false)}
            >
              Hide
            </button>
          </div>
          <TripImporter
            scooterId={scooterId}
            onImportDone={() => setShowImporter(false)}
          />
        </div>
      )}

      {/* Summary strip */}
      <div className={styles.section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 'var(--space-4)', flex: 1 }}>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Total Trips</span>
              <span className={styles.fieldValue} style={{ fontSize: 'var(--text-2xl, 26px)', fontWeight: 800 }}>{myTrips.length}</span>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Total Distance</span>
              <span className={styles.fieldValue} style={{ fontSize: 'var(--text-2xl, 26px)', fontWeight: 800 }}>{formatKm(totalDist)}</span>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Total Duration</span>
              <span className={styles.fieldValue} style={{ fontSize: 'var(--text-2xl, 26px)', fontWeight: 800 }}>{formatMinutes(totalMin)}</span>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Total Revenue</span>
              <span className={styles.fieldValue} style={{ fontSize: 'var(--text-2xl, 26px)', fontWeight: 800, color: 'var(--color-success)' }}>
                {formatEUR(totalRev)}
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
            {!showImporter && (
              <Button variant="outline" size="sm" onClick={() => setShowImporter(true)}>
                <Upload size={13} /> Import CSV
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setClearConfirm(true)}>
              <Trash2 size={13} /> Clear
            </Button>
          </div>
        </div>
      </div>

      {/* Trip table */}
      <div className={styles.section}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Started</th>
                <th>Ended</th>
                <th>Duration</th>
                <th>Distance</th>
                <th>Revenue</th>
                <th>End Reason</th>
                <th>User</th>
              </tr>
            </thead>
            <tbody>
              {myTrips.map((t) => (
                <tr key={t._docId}>
                  <td>{t.startedAt ? t.startedAt.replace('T', ' ').slice(0, 16) : '—'}</td>
                  <td>{t.endedAt   ? t.endedAt.replace('T', ' ').slice(0, 16)   : '—'}</td>
                  <td>{t.durationMinutes != null ? formatMinutes(t.durationMinutes) : '—'}</td>
                  <td>{t.distanceKm     != null ? formatKm(t.distanceKm)           : '—'}</td>
                  <td className={styles.positive}>{t.cost != null ? formatEUR(t.cost) : '—'}</td>
                  <td>{t.endReason || '—'}</td>
                  <td style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs, 11px)', fontFamily: 'monospace' }}>
                    {t.userId || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        isOpen={clearConfirm}
        onClose={() => setClearConfirm(false)}
        title="Clear Trip Data"
        message={`This will permanently delete all ${myTrips.length} trips for scooter #${scooterId}. You can re-import from CSV at any time.`}
        confirmLabel="Clear All Trips"
        onConfirm={async () => {
          await clearTripsForScooter(scooterId);
          setClearConfirm(false);
        }}
        onCancel={() => setClearConfirm(false)}
      />
    </div>
  );
}
