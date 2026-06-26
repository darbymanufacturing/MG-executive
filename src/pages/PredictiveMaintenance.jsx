/**
 * PredictiveMaintenance (PME) — page shell.
 * Wraps PmeTabs and owns the radar-sweep entry animation.
 *
 * On mount: full-screen PmeIntroOverlay plays (~4s radar animation) then
 * dismisses. The existing CSS radarOverlay subtle sweep plays underneath
 * once the intro clears, giving a nice layered transition.
 * Respects prefers-reduced-motion → intro overlay hidden via CSS.
 */
import { useState } from 'react';
import PmeTabs from '../components/PME/PmeTabs.jsx';
import PmeIntroOverlay from '../components/PME/PmeIntroOverlay.jsx';
import styles from './PredictiveMaintenance.module.css';

export default function PredictiveMaintenance() {
  const [showIntro, setShowIntro] = useState(false); // module intro animation removed — only the opening Omni loader animates

  return (
    <div className={styles.page}>
      {/* Full-screen radar intro — plays on every mount, click to skip */}
      {showIntro && <PmeIntroOverlay onDone={() => setShowIntro(false)} />}

      {/* Subtle CSS-only radar sweep (existing, plays after intro clears) */}
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
