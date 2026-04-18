import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wrench, LogOut, WifiOff, ChevronRight, Clock, MapPin, Tag, UserCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useMaintenance } from '../context/MaintenanceContext.jsx';
import styles from './TechnicianDashboard.module.css';

const CATEGORY_LABEL = { Q: 'Quick', M: 'Medium', C: 'Complex', B: 'Blocked', F: 'Finished' };
const CATEGORY_COLOR = { Q: '#00C896', M: '#F5A623', C: '#E84545', B: '#888', F: '#4CAF50' };

function TicketCard({ ticket, techUid, onClaim }) {
  const navigate = useNavigate();
  const isAssignedToMe = ticket.assignedTo === techUid;
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
  const { userProfile, signOut } = useAuth();
  const { tickets, assignTicket, loading } = useMaintenance();
  const uid = userProfile?.uid ?? null;

  // Show tickets assigned to me OR unassigned; exclude Completed
  const myTickets = useMemo(() =>
    tickets.filter((t) =>
      t.status !== 'Completed' &&
      (t.assignedTo === uid || !t.assignedTo)
    ).sort((a, b) => {
      // Mine first, then by days open desc
      if (!!a.assignedTo !== !!b.assignedTo) return a.assignedTo ? -1 : 1;
      return b.daysOpen - a.daysOpen;
    }),
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

      <div className={styles.offlineBanner} id="offline-banner" style={{ display: 'none' }}>
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
              {myTickets.filter((t) => t.assignedTo === uid).length} assigned · {myTickets.filter((t) => !t.assignedTo).length} unassigned
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
      </main>
    </div>
  );
}
