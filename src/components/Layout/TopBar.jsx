import { useRef, useState } from 'react';
import { Sparkles, Paperclip, Mic, Sun, Moon, Bell, Menu, X } from 'lucide-react';
import { useNotifications } from '../../context/NotificationContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import styles from './TopBar.module.css';

function Avatar({ name = 'U', size = 30 }) {
  const initials = name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
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
  const inputRef = useRef(null);
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'User';

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
        <button className="btn btn-ghost btn-sm" onClick={onToggleTheme} title="Toggle theme">
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        <button
          className={`btn btn-ghost btn-sm ${styles.bellBtn}`}
          onClick={onOpenNotifications}
          title="Notifications"
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
