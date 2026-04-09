import { useState, useEffect } from 'react';
import styles from './SprIntroOverlay.module.css';

/**
 * Full-screen techy zoom-in overlay that plays on SPR page mount.
 * Auto-dismisses after ~1.6s total (animation 1.15s + fade 0.45s).
 */
export default function SprIntroOverlay({ onDone }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onDone?.();
    }, 1600);
    return () => clearTimeout(timer);
  }, [onDone]);

  if (!visible) return null;

  return (
    <div className={styles.overlay}>
      {/* Animated perspective grid */}
      <div className={styles.grid} />

      {/* Scanline sweep */}
      <div className={styles.scanline} />

      {/* Corner brackets */}
      <div className={`${styles.corner} ${styles.tl}`} />
      <div className={`${styles.corner} ${styles.tr}`} />
      <div className={`${styles.corner} ${styles.bl}`} />
      <div className={`${styles.corner} ${styles.br}`} />

      {/* Main content */}
      <div className={styles.content}>
        <span className={styles.title}>SPR</span>
        <span className={styles.subtitle}>Spot Performance</span>
        <div className={styles.bar}>
          <div className={styles.barFill} />
        </div>
      </div>
    </div>
  );
}
