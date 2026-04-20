/**
 * AnalyticsTab — wraps PME scooter analytics components.
 * Composes ScooterHealthCard, AnomalyFlags, and ScooterLifetimeStats.
 */

import ScooterHealthCard    from '../../PME/scooter/ScooterHealthCard.jsx';
import AnomalyFlags         from '../../PME/scooter/AnomalyFlags.jsx';
import ScooterLifetimeStats from '../../PME/scooter/ScooterLifetimeStats.jsx';
import styles from './Tab.module.css';

export default function AnalyticsTab({ scooterId }) {
  return (
    <div className={styles.tab}>
      <div className={styles.section} style={{ padding: 0, overflow: 'hidden' }}>
        <ScooterHealthCard scooterId={scooterId} />
      </div>
      <div className={styles.section} style={{ padding: 0, overflow: 'hidden' }}>
        <AnomalyFlags scooterId={scooterId} />
      </div>
      <div className={styles.section} style={{ padding: 0, overflow: 'hidden' }}>
        <ScooterLifetimeStats scooterId={scooterId} />
      </div>
    </div>
  );
}
