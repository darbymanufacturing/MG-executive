/**
 * ServiceHistoryTab — Phase 2.5 F4. Admin scooter-detail tab: the read-only
 * timeline of completed repair sessions (cost + KM + who) for this scooter.
 * Thin wrapper around the shared <ServiceHistory>, also used in the crew job-detail.
 */
import ServiceHistory from '../ServiceHistory.jsx';
import styles from './Tab.module.css';

export default function ServiceHistoryTab({ scooterId }) {
  return (
    <div className={styles.tab}>
      <div className={styles.section}>
        <h3 className={styles.sectionTitle} style={{ marginTop: 0 }}>Service History</h3>
        <ServiceHistory scooterId={scooterId} />
      </div>
    </div>
  );
}
