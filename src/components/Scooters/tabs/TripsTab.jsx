/**
 * TripsTab — displays trip history from scooterTrips collection.
 * Shows empty state with CTA when no trips are loaded for this scooter.
 * CSV import is handled in Settings → Data Imports.
 */

import { useMemo } from 'react';
import { MapPin } from 'lucide-react';
import { useTrips } from '../../../context/TripContext.jsx';
import { formatDate, formatKm, formatMinutes, formatEUR } from '../../../utils/formatters.js';
import styles from './Tab.module.css';

export default function TripsTab({ scooterId }) {
  const { trips, loading } = useTrips();

  const myTrips = useMemo(() =>
    trips
      .filter((t) => String(t.scooterId) === String(scooterId))
      .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || '')),
  [trips, scooterId]);

  if (loading) return <div className={styles.empty}><p>Loading trips…</p></div>;

  if (myTrips.length === 0) {
    return (
      <div className={styles.empty}>
        <MapPin size={32} style={{ opacity: 0.3, marginBottom: 'var(--space-3)' }} />
        <p className={styles.emptyTitle}>No trip data yet</p>
        <p className={styles.emptyText}>
          Import a trip log CSV in <strong>Settings → Data Imports</strong> to see
          individual trip history, total distance, and revenue per trip.
        </p>
      </div>
    );
  }

  const totalDist = myTrips.reduce((s, t) => s + (t.distanceKm || 0), 0);
  const totalMin  = myTrips.reduce((s, t) => s + (t.durationMinutes || 0), 0);
  const totalRev  = myTrips.reduce((s, t) => s + (t.cost || 0), 0);

  return (
    <div className={styles.tab}>
      {/* Summary strip */}
      <div className={styles.section} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 'var(--space-4)' }}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Total Trips</span>
          <span className={styles.fieldValue} style={{ fontSize: 'var(--text-xl, 20px)', fontWeight: 700 }}>{myTrips.length}</span>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Total Distance</span>
          <span className={styles.fieldValue} style={{ fontSize: 'var(--text-xl, 20px)', fontWeight: 700 }}>{formatKm(totalDist)}</span>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Total Duration</span>
          <span className={styles.fieldValue} style={{ fontSize: 'var(--text-xl, 20px)', fontWeight: 700 }}>{formatMinutes(totalMin)}</span>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Total Revenue</span>
          <span className={styles.fieldValue} style={{ fontSize: 'var(--text-xl, 20px)', fontWeight: 700, color: 'var(--color-success)' }}>{formatEUR(totalRev)}</span>
        </div>
      </div>

      {/* Trip table */}
      <div className={styles.section}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Started</th>
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
                  <td>{t.durationMinutes != null ? formatMinutes(t.durationMinutes) : '—'}</td>
                  <td>{t.distanceKm     != null ? formatKm(t.distanceKm)         : '—'}</td>
                  <td className={styles.positive}>{t.cost != null ? formatEUR(t.cost) : '—'}</td>
                  <td>{t.endReason || '—'}</td>
                  <td>{t.userId || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
