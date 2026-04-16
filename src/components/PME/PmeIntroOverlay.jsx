import { useState, useEffect } from 'react';
import styles from './PmeIntroOverlay.module.css';

/**
 * Full-screen radar intro overlay for the PME module.
 * Sonar/radar palette — dark green-black background, rotating sweep arm,
 * three dots appearing in sequence with health-status labels.
 * Auto-dismisses after 4 000ms. Click anywhere to skip early.
 * Respects prefers-reduced-motion (overlay hidden via CSS).
 */
export default function PmeIntroOverlay({ onDone }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(false);
      onDone?.();
    }, 4000);
    return () => clearTimeout(t);
  }, [onDone]);

  function dismiss() {
    setVisible(false);
    onDone?.();
  }

  if (!visible) return null;

  return (
    <div
      className={styles.overlay}
      onClick={dismiss}
      role="dialog"
      aria-label="PME module intro — click to skip"
    >
      {/* ── Radar ring ─────────────────────────────────────────────────── */}
      <div className={styles.radarRing}>
        {/* Inner concentric rings */}
        <div className={styles.ringInner60} />
        <div className={styles.ringInner30} />

        {/* Rotating sweep arm */}
        <div className={styles.radarSweep} />

        {/* Crosshair */}
        <div className={styles.crossH} />
        <div className={styles.crossV} />

        {/* ── Dot 1 — red, top-right, OVERTURNED ── */}
        <div className={`${styles.dotWrap} ${styles.dot1Wrap}`}>
          <div className={`${styles.dot} ${styles.dot1}`} />
          <div className={`${styles.ping} ${styles.ping1}`} />
          <span className={`${styles.label} ${styles.label1}`}>OVERTURNED</span>
        </div>

        {/* ── Dot 2 — amber, left, Inspection in 2 weeks ── */}
        <div className={`${styles.dotWrap} ${styles.dot2Wrap}`}>
          <div className={`${styles.dot} ${styles.dot2}`} />
          <span className={`${styles.label} ${styles.label2}`}>Inspection in 2 weeks</span>
        </div>

        {/* ── Dot 3 — green, bottom-right, Check OK ── */}
        <div className={`${styles.dotWrap} ${styles.dot3Wrap}`}>
          <div className={`${styles.dot} ${styles.dot3}`} />
          <span className={`${styles.label} ${styles.label3}`}>Check OK</span>
        </div>
      </div>

      {/* ── Centre text (above radar ring via z-index) ─────────────────── */}
      <div className={styles.centerContent}>
        <span className={styles.pmeTitle}>PME</span>
        <div className={styles.divider} />
        <span className={styles.pmeSubtitle}>Predictive Maintenance Module</span>
      </div>

      {/* Skip hint */}
      <span className={styles.skipHint}>click anywhere to skip</span>
    </div>
  );
}
