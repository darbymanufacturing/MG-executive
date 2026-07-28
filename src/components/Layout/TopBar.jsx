import { useRef, useState, useEffect } from 'react';
import { Sparkles, Sun, Moon, Bell, Menu, X, RefreshCw } from 'lucide-react';
import { useNotifications } from '../../context/NotificationContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import useHoppSync from '../../hooks/useHoppSync.js';
import FleetSwitcher from './FleetSwitcher.jsx';
import styles from './TopBar.module.css';

function formatRelative(ts) {
  if (!ts) return null;
  const date = ts?.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1)   return 'just now';
  if (min < 60)  return `${min} min ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function Avatar({ name = 'U', size = 30 }) {
  // #179 — use Array.from to correctly handle emoji / surrogate-pair display names
  const initials = name.split(' ').map(s => Array.from(s)[0] ?? '').slice(0, 2).join('').toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'var(--accent)', color: '#fff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: size * 0.42,
      flexShrink: 0, cursor: 'pointer',
    }}>{initials}</div>
  );
}

export default function TopBar({ title, theme, onToggleTheme, onOpenCapture, onOpenNotifications, onMenuToggle, sidebarOpen }) {
  const { unreadCount } = useNotifications();
  const { user } = useAuth();
  const { refresh, syncing, lastSync } = useHoppSync();
  const inputRef = useRef(null);
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'User';

  // #188 — tick every 60 s so relative time in refreshTitle stays fresh
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const refreshTitle = syncing
    ? 'Syncing…'
    : lastSync?.finishedAt
      ? `Refresh — last synced ${formatRelative(lastSync.finishedAt)}`
      : 'Refresh data from Hopp';

  const handleCaptureBarClick = () => {
    onOpenCapture?.();
    inputRef.current?.blur();
  };

  return (
    <header className={styles.topbar}>
      {/* Mobile menu button */}
      <button
        className={styles.menuBtn}
        onClick={onMenuToggle}
        aria-label="Toggle menu"
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      <div className={styles.titleArea}>
        <span className={styles.title}>{title}</span>
      </div>

      {/* FF-3 — fleet switcher (active fleet / All Fleets) */}
      <FleetSwitcher />

      {/* Capture bar — clickable, opens modal */}
      <div className={styles.captureBar} onClick={handleCaptureBarClick} role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleCaptureBarClick(); }}>
        <Sparkles size={15} className={styles.captureIcon} />
        <span className={styles.capturePlaceholder}>
          Capture anything — phone call, lead, issue, expense…
        </span>
        <div className={styles.captureRight}>
          <span className="kbd">⌘K</span>
        </div>
      </div>

      {/* Actions */}
      <div className={styles.actions}>
        {/* Refresh — manual Hopp sync trigger; kicks the always-on hopp-sync worker
            (twice-daily schedule), useful when you want fresh data without waiting.
            See docs/runbooks/hopp-sync-troubleshooting.md. */}
        <button
          className={`btn btn-ghost btn-sm ${styles.refreshBtn} ${syncing ? styles.refreshing : ''}`}
          onClick={refresh}
          disabled={syncing}
          title={refreshTitle}
          aria-label="Refresh data from Hopp"
        >
          <RefreshCw size={16} />
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={onToggleTheme}
          title="Toggle theme"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        <button
          className={`btn btn-ghost btn-sm ${styles.bellBtn}`}
          onClick={onOpenNotifications}
          title="Notifications"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        >
          <Bell size={16} />
          {unreadCount > 0 && (
            <span className={styles.bellDot} />
          )}
        </button>

        <div className={styles.divider} />
        <Avatar name={displayName} size={30} />
      </div>
    </header>
  );
}
