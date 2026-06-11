import { CheckCircle } from 'lucide-react';
import styles from './ActiveTicketsList.module.css';

const STATUS_COLORS = {
  Active:            '#0ea5e9',
  Backlog:           '#888',
  Investigation:     '#FF9800',
  Blocked:           '#F44336',
  'To be Repainted': '#A0521D',
  Donor:             '#8E24AA',
  Completed:         '#4CAF50',
};

function truncate(str, max) {
  if (!str) return '—';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

export default function ActiveTicketsList({ tickets }) {
  const displayTickets = tickets.filter((t) => t.status === 'Active').slice(0, 3);

  if (displayTickets.length === 0) {
    return (
      <div className={styles.empty}>
        <CheckCircle size={24} className={styles.emptyIcon} />
        <span className={styles.emptyText}>No active repairs</span>
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {displayTickets.map((ticket) => {
        const statusColor = STATUS_COLORS[ticket.status] ?? '#888';
        return (
          <div key={ticket._docId} className={styles.card}>
            <div className={styles.cardTop}>
              <span className={styles.scooterId}>{ticket.scooterId ?? '—'}</span>
              <span
                className={styles.statusBadge}
                style={{ background: `${statusColor}22`, color: statusColor, borderColor: `${statusColor}44` }}
              >
                {ticket.status}
              </span>
            </div>
            <p className={styles.issue}>{truncate(ticket.issueDescription, 60)}</p>
            <div className={styles.meta}>
              <span className={styles.metaItem}>{ticket.city ?? '—'}</span>
              <span className={styles.metaDot}>·</span>
              <span className={styles.metaItem}>{ticket.daysOpen ?? 0}d open</span>
              <span className={styles.metaDot}>·</span>
              <span className={styles.metaItem} style={{ color: '#F44336' }}>
                €{(ticket.revenueLost ?? 0).toFixed(0)} lost
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
