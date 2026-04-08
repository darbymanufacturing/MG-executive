import { NavLink } from 'react-router-dom';
import { LayoutDashboard, ListChecks, Receipt, Settings, Bike } from 'lucide-react';
import styles from './Sidebar.module.css';

const NAV = [
  { to: '/',        icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/costs',   icon: ListChecks,      label: 'Cost Manager' },
  { to: '/revenue', icon: Receipt,         label: 'Revenue' },
  { to: '/settings',icon: Settings,        label: 'Settings' },
];

export default function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <img src="/logo.svg" alt="XSlide" className={styles.logoImg} />
      </div>

      <nav className={styles.nav}>
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
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
        <Bike size={14} className={styles.footerIcon} />
        <span>XSlide Fleet Manager</span>
      </div>
    </aside>
  );
}
