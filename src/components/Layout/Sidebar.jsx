import { NavLink } from 'react-router-dom';
import { LayoutDashboard, ListChecks, Receipt, Settings, LogOut, Radar, Wrench, FolderKanban } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import styles from './Sidebar.module.css';

const NAV = [
  { to: '/',           icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/projects',   icon: FolderKanban,    label: 'Projects' },
  { to: '/costs',      icon: ListChecks,      label: 'Cost Manager' },
  { to: '/revenue',    icon: Receipt,         label: 'Revenue' },
  { to: '/spr',        icon: Radar,           label: 'SPR' },
  { to: '/maintenance', icon: Wrench,         label: 'Maintenance' },
  { to: '/settings',   icon: Settings,        label: 'Settings' },
];

export default function Sidebar({ open, onClose }) {
  const { user, signOut } = useAuth();

  return (
    <aside className={`${styles.sidebar} ${open ? styles.open : ''}`}>
      <div className={styles.logo}>
        <img src="/logo.svg" alt="XSlide" className={styles.logoImg} />
      </div>

      <nav className={styles.nav}>
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={onClose}
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.active : ''}`
            }
          >
            <Icon size={18} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

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
