import { useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Inbox, Sparkles, Activity, Bell, Flag, Wrench, Folder,
  Users, Receipt, Landmark, Package, Settings, ChevronLeft, ChevronRight,
  LogOut, Radar, Crosshair, Bike, TrendingUp, Zap, HardHat, ClipboardList,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNotifications } from '../../context/NotificationContext.jsx';
import { useIssues } from '../../context/IssueContext.jsx';
import { useMaintenance } from '../../context/MaintenanceContext.jsx';
import AsterismMark from '../Shared/AsterismMark.jsx';
import styles from './Sidebar.module.css';

/* ─── Nav structure ─── */
const NAV_PRIMARY = [
  { to: '/',       icon: Inbox,     label: 'Inbox',         key: 'inbox' },
  { to: '/brief',  icon: Sparkles,  label: 'Daily Brief',   key: 'brief' },
  { to: '/pulse',  icon: Activity,  label: 'Pulse',         key: 'pulse' },
];

const NAV_OPERATIONS = [
  { to: '/issues',      icon: Flag,        label: 'Issues',    key: 'issues'   },
  { to: '/maintenance', icon: Wrench,      label: 'Tickets',   key: 'tickets'  },
  { to: '/projects',    icon: ClipboardList,label: 'Projects',  key: 'projects' },
  { to: '/crew',        icon: Users,       label: 'Crew',      key: 'crew'     },
  { to: '/war-room',    icon: Crosshair,   label: 'War Room',  key: 'warroom'  },
  { to: '/scooters',    icon: Bike,        label: 'Scooters',  key: 'scooters' },
  { to: '/pme',         icon: Activity,    label: 'PME',       key: 'pme'      },
  { to: '/pow',         icon: Zap,         label: 'POW v3',    key: 'pow'      },
];

const NAV_FINANCE = [
  { to: '/costs',      icon: Receipt,    label: 'Costs',    key: 'costs'    },
  { to: '/revenue',    icon: TrendingUp, label: 'Revenue',  key: 'revenue'  },
  { to: '/investment', icon: Landmark,   label: 'Investment', key: 'invest' },
  { to: '/spr',        icon: Radar,      label: 'SPR',      key: 'spr'      },
];

function Avatar({ name = 'U', size = 28 }) {
  const initials = (() => {
    if (!name?.trim()) return 'U';
    return name.trim().split(' ').map(s => Array.from(s)[0] || '').slice(0, 2).join('').toUpperCase();
  })();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'var(--accent)', color: '#fff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: size * 0.42,
      flexShrink: 0, letterSpacing: '-0.01em',
    }}>{initials}</div>
  );
}

function NavItem({ to, icon: Icon, label, badge, collapsed, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        `${styles.navItem} ${isActive ? styles.active : ''} ${collapsed ? styles.collapsed : ''}`
      }
    >
      {/* #285 — React Router v7 NavLink auto-applies aria-current="page" on the active link */}
      {({ isActive }) => (
        <>
          {isActive && !collapsed && <div className={styles.activeStripe} />}
          <Icon size={16} strokeWidth={isActive ? 2.2 : 1.8} />
          {!collapsed && (
            <span className="omni-sidebar-label" style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden' }}>
              {label}
            </span>
          )}
          {badge != null && !collapsed && (
            <span className={`omni-sidebar-badge ${styles.badge} ${isActive ? styles.badgeActive : ''}`}>
              {badge}
            </span>
          )}
          {badge != null && collapsed && <span className={styles.badgeDot} />}
        </>
      )}
    </NavLink>
  );
}

function SidebarSection({ label, children, collapsed }) {
  return (
    <div className={styles.section}>
      {!collapsed ? (
        <div className={`omni-sidebar-section ${styles.sectionLabel}`}>{label}</div>
      ) : (
        <div className={styles.sectionDivider} />
      )}
      {children}
    </div>
  );
}

// #84 — safe wrappers: call the hooks but catch the "must be inside provider" error.
//  React rules of hooks require hooks to be called unconditionally, so we call them
//  at the top level inside the component below. These helpers let us handle the
//  case where a provider is absent without crashing.
function useSafeIssues() {
  try { return useIssues(); } catch { return null; }
}
function useSafeMaintenance() {
  try { return useMaintenance(); } catch { return null; }
}

export default function Sidebar({ open, onClose, collapsed = false, onCollapse }) {
  const { user, signOut, userRole } = useAuth();
  const { badgeCount } = useNotifications();
  // #84 — safe reads: null when provider is absent
  const issueCtx = useSafeIssues();
  const maintenanceCtx = useSafeMaintenance();
  const openIssueCount = (issueCtx?.issues ?? []).filter(i => i.status !== 'done').length;
  const activeCount = maintenanceCtx?.activeCount ?? 0;
  const navigate = useNavigate();

  const handleSignOut = useCallback(async () => {
    await signOut();
    navigate('/login');
  }, [signOut, navigate]);

  /* Crew members only see the /crew shell */
  if (userRole === 'technician' || userRole === 'crew') return null;

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'User';

  return (
    <>
      {/* Mobile overlay */}
      {open && <div className={styles.overlay} onClick={onClose} />}

      <aside
        className={`omni-sidebar ${styles.sidebar} ${open ? styles.open : ''}`}
        data-collapsed={collapsed}
        style={{ width: collapsed ? 'var(--sidebar-width-collapsed)' : 'var(--sidebar-width)' }}
      >
        {/* Brand + collapse toggle */}
        <div className={`${styles.brand} ${collapsed ? styles.brandCollapsed : ''}`}>
          {/* Omni Asterism mark — see docs/BRANDING.md.
              Sidebar background is dark (--bg-sidebar = #0F172A), so ink rays flip to white.
              The rust ray (north) stays rust per spec. */}
          <div className={styles.omniMark}>
            <AsterismMark size={26} fg="#FFFFFF" />
          </div>
          {!collapsed && (
            <span className={`omni-sidebar-brandtext ${styles.brandText}`}>omni</span>
          )}
          <button
            className={styles.collapseBtn}
            onClick={() => onCollapse?.(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
          </button>
        </div>

        {/* Primary nav */}
        <nav className={styles.nav}>
          <NavItem to="/" icon={Inbox} label="Inbox" badge={badgeCount > 0 ? badgeCount : undefined} collapsed={collapsed} end />
          <NavItem to="/brief" icon={Sparkles} label="Daily Brief" collapsed={collapsed} />
          <NavItem to="/pulse" icon={Activity} label="Pulse" collapsed={collapsed} />
          <NavItem to="/notifications" icon={Bell} label="Notifications" collapsed={collapsed} />
        </nav>

        {/* Operations section */}
        <SidebarSection label="Operations" collapsed={collapsed}>
          <NavItem to="/issues"      icon={Flag}          label="Issues"    badge={openIssueCount > 0 ? openIssueCount : undefined} collapsed={collapsed} />
          <NavItem to="/maintenance" icon={Wrench}        label="Tickets"   badge={activeCount > 0 ? activeCount : undefined} collapsed={collapsed} />
          <NavItem to="/projects"    icon={ClipboardList} label="Projects"  collapsed={collapsed} />
          <NavItem to="/crew"        icon={Users}         label="Crew"      collapsed={collapsed} />
          <NavItem to="/war-room"    icon={Crosshair}     label="War Room"  collapsed={collapsed} />
          <NavItem to="/scooters"    icon={Bike}          label="Scooters"  collapsed={collapsed} />
          <NavItem to="/pme"         icon={Activity}      label="PME"       collapsed={collapsed} />
          <NavItem to="/pow"         icon={Zap}           label="POW v3"    collapsed={collapsed} />
        </SidebarSection>

        {/* Finance section */}
        <SidebarSection label="Finance" collapsed={collapsed}>
          <NavItem to="/costs"      icon={Receipt}    label="Costs"      collapsed={collapsed} />
          <NavItem to="/revenue"    icon={TrendingUp} label="Revenue"    collapsed={collapsed} />
          <NavItem to="/investment" icon={Landmark}   label="Investment" collapsed={collapsed} />
          <NavItem to="/spr"        icon={Radar}      label="SPR"        collapsed={collapsed} />
        </SidebarSection>

        <div style={{ flex: 1 }} />

        {/* Footer */}
        <div className={styles.footer}>
          <NavItem to="/settings" icon={Settings} label="Settings" collapsed={collapsed} />
          <div className={`omni-sidebar-user ${styles.userRow} ${collapsed ? styles.userRowCollapsed : ''}`}>
            <Avatar name={displayName} size={28} />
            {!collapsed && (
              <div className={`omni-sidebar-user-text ${styles.userInfo}`}>
                <span className={styles.userName}>{displayName}</span>
                <span className={styles.userRole}>Founder · Admin</span>
              </div>
            )}
            {!collapsed && (
              <button className={styles.logoutBtn} onClick={handleSignOut} title="Sign out" aria-label="Sign out">
                <LogOut size={13} />
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
