import { useNavigate } from 'react-router-dom';
import { Bell, Check, X, Zap, Flag, Wrench } from 'lucide-react';
import { useNotifications } from '../context/NotificationContext.jsx';
import { useIssues } from '../context/IssueContext.jsx';
import styles from './Notifications.module.css';

const TYPE_ICON = {
  pow:         Zap,
  issue:       Flag,
  ticket:      Wrench,
  maintenance: Wrench,
  default:     Bell,
};

function timeAgo(ts) {
  if (!ts) return '';
  const ms = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function NotifRow({ notif, onDismiss }) {
  const Icon = TYPE_ICON[notif.type] || TYPE_ICON.default;
  return (
    <div className={`${styles.row} ${notif.dismissed ? styles.rowDismissed : ''}`}>
      <div className={styles.iconWrap}>
        <Icon size={14} />
      </div>
      <div className={styles.body}>
        <div className={styles.message}>{notif.message}</div>
        <div className={styles.meta}>
          <span className={styles.time}>{timeAgo(notif.createdAt)}</span>
          {notif.type && <span className="pill pill-grey" style={{ fontSize: 10 }}>{notif.type}</span>}
        </div>
      </div>
      {!notif.dismissed && (
        <button
          className="btn btn-ghost btn-xs"
          onClick={() => onDismiss(notif.id)}
          title="Dismiss"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

function IssueRow({ issue }) {
  const navigate = useNavigate();
  return (
    <div className={`${styles.row} ${styles.rowClickable}`} onClick={() => navigate(`/issues/${issue.id}`)}>
      <div className={styles.iconWrap} style={{ background: 'color-mix(in oklab, var(--status-amber) 18%, var(--bg-section))' }}>
        <Flag size={14} style={{ color: 'var(--status-amber)' }} />
      </div>
      <div className={styles.body}>
        <div className={styles.message}>{issue.title}</div>
        <div className={styles.meta}>
          <span className={styles.time}>{timeAgo(issue.createdAt?.toDate?.() || issue.createdAt)}</span>
          <span className={`pill pill-${issue.urgency === 'critical' ? 'red' : issue.urgency === 'high' ? 'amber' : 'blue'}`} style={{ fontSize: 10 }}>
            {issue.urgency}
          </span>
          <span className="pill pill-grey" style={{ fontSize: 10 }}>Issue</span>
        </div>
      </div>
    </div>
  );
}

export default function Notifications() {
  const { notifications, activeNotifications, dismissNotification, dismissAll } = useNotifications();
  const { issues } = useIssues();

  /* Recent issues (last 7 days) as notification-like items */
  const recentIssues = (issues || [])
    .filter(i => {
      const created = i.createdAt?.toDate?.() || new Date(i.createdAt || 0);
      return Date.now() - created.getTime() < 7 * 86400_000;
    })
    .slice(0, 10);

  const hasAny = notifications.length > 0 || recentIssues.length > 0;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Notifications</h1>
          <p className={styles.pageSubtitle}>System alerts and recent activity</p>
        </div>
        {activeNotifications.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={dismissAll}>
            <Check size={13} />Mark all read
          </button>
        )}
      </div>

      {!hasAny && (
        <div className={`card ${styles.empty}`}>
          <Bell size={32} style={{ color: 'var(--fg-muted)' }} />
          <div className={styles.emptyTitle}>All caught up</div>
          <div className={styles.emptySub}>No notifications right now.</div>
        </div>
      )}

      {/* System notifications */}
      {notifications.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionLabel}>System</div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {notifications.map(n => (
              <NotifRow key={n.id} notif={n} onDismiss={dismissNotification} />
            ))}
          </div>
        </section>
      )}

      {/* Recent issues */}
      {recentIssues.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionLabel}>Recent Issues · last 7 days</div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {recentIssues.map(issue => (
              <IssueRow key={issue.id} issue={issue} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
