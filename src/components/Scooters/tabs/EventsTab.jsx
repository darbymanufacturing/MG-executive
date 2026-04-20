/**
 * EventsTab — wraps the existing ScooterEventTimeline component.
 */

import ScooterEventTimeline from '../../PME/scooter/ScooterEventTimeline.jsx';
import styles from './Tab.module.css';

export default function EventsTab({ scooterId }) {
  return (
    <div className={styles.tab}>
      <div className={styles.section} style={{ padding: 0, overflow: 'hidden' }}>
        <ScooterEventTimeline scooterId={scooterId} />
      </div>
    </div>
  );
}
