import { useState, useEffect } from 'react';
import { Cog, Wrench } from 'lucide-react';
import styles from './MaintenanceIntroOverlay.module.css';

/**
 * Full-screen techy zoom-in overlay for the Maintenance module.
 * Blue/green colour palette. Auto-dismisses after 1.6s.
 */
export default function MaintenanceIntroOverlay({ onDone }) {
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

      {/* Corner brackets with icons */}
      <div className={`${styles.corner} ${styles.tl}`} />
      <div className={`${styles.corner} ${styles.tr}`}>
        <Cog size={22} className={styles.cogIcon} />
      </div>
      <div className={`${styles.corner} ${styles.bl}`}>
        <Wrench size={20} className={styles.wrenchIcon} />
      </div>
      <div className={`${styles.corner} ${styles.br}`} />

      {/* Main content */}
      <div className={styles.content}>
        <div className={styles.iconRow}>
          <Wrench size={28} className={styles.titleWrench} />
          <Cog size={24} className={styles.titleCog} />
        </div>
        <span className={styles.title}>MAINTENANCE MASTER</span>
        <span className={styles.subtitle}>SYSTEM V3</span>
        <div className={styles.bar}>
          <div className={styles.barFill} />
        </div>
      </div>
    </div>
  );
}
