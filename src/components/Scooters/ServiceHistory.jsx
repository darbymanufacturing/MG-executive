/**
 * ServiceHistory — Phase 2.5 F4. Read-only timeline of COMPLETED repair sessions
 * for one scooter (date · KM · what · who · cost), sourced from `repairSessions`
 * (org-scoped, ADR-0003). Distinct from RepairsTab, which manages the ticket queue
 * (`maintenanceTickets`); this is the audit log of finished repairs with the F1 pay
 * breakdown + F2 approval status + F3 signature.
 *
 * Reused in the admin scooter detail (ServiceHistoryTab) and the crew job-detail.
 * Matches the design handoff timeline (images/09-job-detail).
 */
import { useMemo } from 'react';
import { Wrench, Clock, Euro, User, Gauge, CheckCircle2, AlertCircle } from 'lucide-react';
import { useOrgCollection } from '../../hooks/useOrgCollection.js';
import { formatDate, formatEUR } from '../../utils/formatters.js';
import styles from './ServiceHistory.module.css';

const COST_STATUS = {
  pending:  { label: 'Pending', color: 'var(--status-blue, #2563EB)' },
  approved: { label: 'Approved', color: 'var(--status-green, #15803D)' },
  rejected: { label: 'Rejected', color: 'var(--status-red, #DC2626)' },
};

export default function ServiceHistory({ scooterId, limit = 50 }) {
  // Org-scoped read of completed repair sessions for THIS scooter, newest first.
  // Two equality/range filters (orgId + scooterId) + orderBy(completedAt) → needs
  // the composite index repairSessions (orgId, scooterId, completedAt desc).
  const { items, loading, error } = useOrgCollection('repairSessions', {
    where: [['scooterId', '==', String(scooterId)]],
    orderBy: ['completedAt', 'desc'],
    limit,
  });

  const sessions = useMemo(() => items.map(({ _docId, ...rest }) => ({ id: _docId, ...rest })), [items]);

  if (loading) return <p className={styles.muted}>Loading service history…</p>;
  if (error) return <p className={styles.muted}>Couldn’t load service history.</p>;
  if (!sessions.length) {
    return (
      <div className={styles.empty}>
        <Wrench size={28} />
        <p>No completed repairs yet for this scooter.</p>
      </div>
    );
  }

  return (
    <div className={styles.timeline}>
      {sessions.map((s, i) => {
        const status = COST_STATUS[s.costStatus] ?? COST_STATUS.pending;
        const total = s.totalCost ?? s.totalPartsCost ?? 0;
        return (
          <div key={s.id} className={styles.entry}>
            <div className={styles.railCol}>
              <span className={`${styles.dot} ${i === 0 ? styles.dotLatest : ''}`} />
              {i < sessions.length - 1 && <span className={styles.line} />}
            </div>
            <div className={styles.card}>
              <div className={styles.head}>
                <span className={styles.date}>{formatDate(s.completedAt)}</span>
                <span className={styles.status} style={{ color: status.color, borderColor: status.color }}>
                  {s.costStatus === 'rejected' ? <AlertCircle size={11} /> : <CheckCircle2 size={11} />}
                  {status.label}
                </span>
              </div>
              <div className={styles.what}>
                {s.aggregatedPartsUsed?.length
                  ? s.aggregatedPartsUsed.map((p) => p.partName).filter(Boolean).join(', ')
                  : 'Repair completed'}
              </div>
              <div className={styles.meta}>
                {s.technicianName && <span className={styles.metaItem}><User size={11} />{s.technicianName}</span>}
                {typeof s.labourMinutes === 'number' && <span className={styles.metaItem}><Clock size={11} />{s.labourMinutes} min</span>}
                {s.odometerKm != null && <span className={styles.metaItem}><Gauge size={11} />{s.odometerKm} km</span>}
                <span className={styles.cost}><Euro size={11} />{formatEUR(total).replace('€', '')}</span>
              </div>
              {s.costStatus === 'rejected' && s.rejectionReason && (
                <p className={styles.reject}>Rejected: {s.rejectionReason}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
