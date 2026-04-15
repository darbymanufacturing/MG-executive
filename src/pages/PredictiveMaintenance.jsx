/**
 * PredictiveMaintenance (PME) — page shell.
 * Wraps PmeTabs and owns the radar-sweep entry animation.
 *
 * Animation: on mount a rotating conic-gradient overlay sweeps 360° (900ms),
 * simultaneous with content fading in from 0 → 1 opacity.
 * Respects prefers-reduced-motion → plain fade only.
 */
import PmeTabs from '../components/PME/PmeTabs.jsx';
import styles from './PredictiveMaintenance.module.css';

export default function PredictiveMaintenance() {
  return (
    <div className={styles.page}>
      {/* Radar sweep overlay — CSS-only, removes itself after animation ends */}
      <div className={styles.radarOverlay} aria-hidden />

      {/* Page header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Predictive Maintenance</h1>
          <span className={styles.badge}>PME</span>
        </div>
        <p className={styles.sub}>
          Upload telemetry → detect overturn patterns → predict repairs before they happen.
        </p>
      </div>

      {/* Main content */}
      <div className={styles.body}>
        <PmeTabs />
      </div>
    </div>
  );
}
