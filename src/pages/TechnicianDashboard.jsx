import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wrench, LogOut, WifiOff, ChevronRight, Clock, MapPin, Tag, UserCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useMaintenance } from '../context/MaintenanceContext.jsx';
import styles from './TechnicianDashboard.module.css';

const CATEGORY_LABEL = { Q: 'Quick', M: 'Medium', C: 'Complex', B: 'Blocked', F: 'Finished' };
const CATEGORY_COLOR = { Q: '#00C896', M: '#F5A623', C: '#E84545', B: '#888', F: '#4CAF50' };

// Phase 2.5 F2 — cost-approval status badge for the tech's completed jobs.
const COST_STATUS = {
  pending:  { label: 'Pending approval', color: '#D97706' },
  approved: { label: 'Approved',         color: '#15803D' },
  rejected: { label: 'Rejected',         color: '#DC2626' },
};

function CostStatusBadge({ status }) {
  const s = COST_STATUS[status] ?? COST_STATUS.pending;
  return (
    <span
      style={{
        display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
        background: `${s.color}1a`, color: s.color, border: `1px solid ${s.color}40`,
      }}
    >
      {s.label}
    </span>
  );
}

function TicketCard({ ticket, techUid, onClaim }) {
  const navigate = useNavigate();
  const _isAssignedToMe = ticket.assignedTo === techUid;
  const isUnassigned   = !ticket.assignedTo;

  const catColor = CATEGORY_COLOR[ticket.category] ?? '#888';

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.scooterRow}>
          <span className={styles.scooterId}>{ticket.scooterId || '—'}</span>
          <span
            className={styles.catBadge}
            style={{ background: `${catColor}22`, color: catColor, borderColor: `${catColor}44` }}
          >
            {CATEGORY_LABEL[ticket.category] ?? ticket.category}
          </span>
          {isUnassigned && (
            <span className={styles.unassignedBadge}>Unassigned</span>
          )}
        </div>
        <p className={styles.issueDesc}>{ticket.issueDescription || 'No description'}</p>
      </div>

      <div className={styles.cardMeta}>
        {ticket.city && (
          <span className={styles.metaItem}>
            <MapPin size={12} />
            {ticket.city}
          </span>
        )}
        {ticket.primaryTag && (
          <span className={styles.metaItem}>
            <Tag size={12} />
            {ticket.primaryTag}
          </span>
        )}
        <span className={styles.metaItem}>
          <Clock size={12} />
          {ticket.daysOpen === 1 ? '1 day open' : `${ticket.daysOpen} days open`}
        </span>
      </div>

      <div className={styles.cardFooter}>
        {isUnassigned && (
          <button
            className={styles.claimBtn}
            onClick={(e) => { e.stopPropagation(); onClaim(ticket._docId); }}
          >
            <UserCheck size={14} />
            Claim
          </button>
        )}
        <button
          className={styles.startBtn}
          onClick={() => navigate(`/technician/${ticket._docId}`)}
        >
          Start Repair
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

export default function TechnicianDashboard() {
  const { user, userProfile, userRole, signOut } = useAuth();
  const { tickets, assignTicket, loading } = useMaintenance();
  const uid = user?.uid ?? null;

  // #164: wire offline banner to actual network status
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const handleOnline  = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Phase 2.5 F5 — a contractor (external) is scoped to their assigned scooters only:
  // they see tickets for those scooters, and NOT the org's unassigned pool. crew/
  // technician keep the prior behavior (their own + unassigned). Admin sees all.
  // (This is the assignment VIEW; org isolation + write-scope are enforced by rules.)
  const assignedScooterIds = useMemo(
    () => new Set((userProfile?.assignedScooterIds ?? []).map(String)),
    [userProfile],
  );

  const myTickets = useMemo(() =>
    tickets.filter((t) => {
      if (t.status === 'Completed') return false;
      if (userRole === 'admin') return true;
      if (userRole === 'contractor') {
        return t.assignedTo === uid || assignedScooterIds.has(String(t.scooterId));
      }
      return t.assignedTo === uid || !t.assignedTo;
    }).sort((a, b) => {
      // Assigned-to-me first, then unassigned, then others; within group sort by days open desc
      const rank = (t) => (t.assignedTo === uid ? 0 : !t.assignedTo ? 1 : 2);
      return rank(a) - rank(b) || b.daysOpen - a.daysOpen;
    }),
  [tickets, uid, userRole, assignedScooterIds]);

  // Phase 2.5 F2 — the tech's own completed jobs + their cost-approval status,
  // so they can see whether they'll be paid (pending / approved / rejected).
  const myCompleted = useMemo(() =>
    tickets
      .filter((t) => t.status === 'Completed' && t.completedBy === uid)
      .sort((a, b) => String(b.dateCompleted ?? '').localeCompare(String(a.dateCompleted ?? '')))
      .slice(0, 20),
  [tickets, uid]);

  async function handleClaim(docId) {
    await assignTicket(docId, uid, userProfile?.displayName ?? '');
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Wrench size={20} className={styles.headerIcon} />
          <span className={styles.headerTitle}>Repair Queue</span>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.techName}>{userProfile?.displayName}</span>
          <button className={styles.logoutBtn} onClick={signOut} aria-label="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <div className={styles.offlineBanner} id="offline-banner" style={{ display: isOffline ? 'flex' : 'none' }}>
        <WifiOff size={14} />
        <span>Working offline — changes will sync when reconnected</span>
      </div>

      <main className={styles.main}>
        {loading ? (
          <div className={styles.emptyState}>
            <p className={styles.emptyDesc}>Loading tickets…</p>
          </div>
        ) : myTickets.length === 0 ? (
          <div className={styles.emptyState}>
            <Wrench size={48} className={styles.emptyIcon} />
            <h2 className={styles.emptyTitle}>All clear</h2>
            <p className={styles.emptyDesc}>No tickets assigned to you or available to claim.</p>
          </div>
        ) : (
          <>
            <p className={styles.queueCount}>
              {myTickets.filter((t) => t.assignedTo).length} assigned · {myTickets.filter((t) => !t.assignedTo).length} unassigned
            </p>
            <div className={styles.ticketList}>
              {myTickets.map((t) => (
                <TicketCard
                  key={t._docId}
                  ticket={t}
                  techUid={uid}
                  onClaim={handleClaim}
                />
              ))}
            </div>
          </>
        )}

        {/* Phase 2.5 F2 — the tech's completed jobs + cost-approval status */}
        {myCompleted.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <p className={styles.queueCount}>Completed by you</p>
            <div className={styles.ticketList}>
              {myCompleted.map((t) => (
                <div key={t._docId} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <div className={styles.scooterRow}>
                      <span className={styles.scooterId}>{t.scooterId || '—'}</span>
                      <CostStatusBadge status={t.costStatus} />
                    </div>
                    <p className={styles.issueDesc}>{t.issueDescription || 'No description'}</p>
                  </div>
                  <div className={styles.cardMeta}>
                    {t.dateCompleted && (
                      <span className={styles.metaItem}><Clock size={12} />{t.dateCompleted}</span>
                    )}
                    {typeof t.totalCost === 'number' && (
                      <span className={styles.metaItem}>€{t.totalCost.toFixed(2)}</span>
                    )}
                  </div>
                  {t.costStatus === 'rejected' && t.rejectionReason && (
                    <p className={styles.issueDesc} style={{ color: '#DC2626' }}>Reason: {t.rejectionReason}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
