import { Wrench, LogOut, WifiOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import styles from './TechnicianDashboard.module.css';

export default function TechnicianDashboard() {
  const { userProfile, signOut } = useAuth();

  return (
    <div className={styles.shell}>
      {/* Mobile header */}
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

      {/* Offline indicator */}
      <div className={styles.offlineBanner} id="offline-banner" style={{ display: 'none' }}>
        <WifiOff size={14} />
        <span>Working offline — changes will sync when reconnected</span>
      </div>

      {/* Content — populated in Phase 3 */}
      <main className={styles.main}>
        <div className={styles.emptyState}>
          <Wrench size={48} className={styles.emptyIcon} />
          <h2 className={styles.emptyTitle}>No tickets assigned</h2>
          <p className={styles.emptyDesc}>
            Your repair queue is empty. Check back when tickets are assigned to you.
          </p>
        </div>
      </main>
    </div>
  );
}
