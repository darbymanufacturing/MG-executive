import { useState, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, ListChecks, Receipt, Settings, LogOut, Radar, Wrench, Crosshair, ClipboardList, Activity, HardHat, TrendingUp, Bike, Zap } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNotifications } from '../../context/NotificationContext.jsx';
import SparkleBurst from '../PME/shared/SparkleBurst.jsx';
import styles from './Sidebar.module.css';

const NAV = [
  { to: '/',            icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/projects',    icon: ClipboardList,   label: 'Projects' },
  { to: '/war-room',    icon: Crosshair,       label: 'War Room' },
  { to: '/scooters',    icon: Bike,            label: 'Scooters' },
  { to: '/investment',  icon: TrendingUp,      label: 'Investment' },
  { to: '/costs',       icon: ListChecks,      label: 'Cost Manager' },
  { to: '/revenue',     icon: Receipt,         label: 'Revenue' },
  { to: '/spr',         icon: Radar,           label: 'SPR' },
  { to: '/maintenance', icon: Wrench,          label: 'Maintenance' },
  { to: '/technician',  icon: HardHat,         label: 'Tech Queue' },
  { to: '/pme',         icon: Activity,        label: 'PME',         sparkle: true },
  { to: '/pow',         icon: Zap,             label: 'POW v3' },
  { to: '/settings',    icon: Settings,        label: 'Settings' },
];

export default function Sidebar({ open, onClose }) {
  const { user, signOut } = useAuth();
  const { badgeCount } = useNotifications();
  const [burst, setBurst] = useState(null); // { x, y } or null

  const handlePmeClick = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setBurst({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    onClose?.();
  }, [onClose]);

  return (
    <aside className={`${styles.sidebar} ${open ? styles.open : ''}`}>
      <div className={styles.logo}>
        <img src="/logo.svg" alt="XSlide" className={styles.logoImg} />
      </div>

      <nav className={styles.nav}>
        {NAV.map(({ to, icon: Icon, label, sparkle }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={sparkle ? handlePmeClick : onClose}
            onMouseEnter={to === '/war-room' ? () => {
              // Ensure mapbox-gl chunk is cached before the click lands
              import('mapbox-gl').catch(() => {});
            } : undefined}
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.active : ''} ${sparkle ? styles.pmeItem : ''}`
            }
          >
            <Icon size={18} />
            <span>{label}</span>
            {to === '/projects' && badgeCount > 0 && (
              <span className={styles.badge}>{badgeCount}</span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Sparkle burst on PME click */}
      {burst && (
        <SparkleBurst
          x={burst.x}
          y={burst.y}
          onDone={() => setBurst(null)}
        />
      )}

      <div className={styles.footer}>
        <div className={styles.userInfo}>
          <span className={styles.userEmail} title={user?.email}>
            {user?.email}
          </span>
          <button
            className={styles.logoutBtn}
            onClick={signOut}
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}
