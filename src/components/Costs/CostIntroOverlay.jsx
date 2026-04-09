import { useState, useEffect } from 'react';
import { Flame, AlertTriangle } from 'lucide-react';
import styles from './CostIntroOverlay.module.css';

export default function CostIntroOverlay({ onDone }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => { setVisible(false); onDone?.(); }, 1700);
    return () => clearTimeout(t);
  }, [onDone]);

  if (!visible) return null;

  return (
    <div className={styles.overlay}>

      {/* ── Immediate red flash on mount ── */}
      <div className={styles.flash} />

      {/* ── Heat-shimmer distortion layer ── */}
      <div className={styles.heatLayer} />

      {/* ── Grid — CRASHES down from above ── */}
      <div className={styles.grid} />

      {/* ── Scanline — burning red ── */}
      <div className={styles.scanline} />

      {/* ── Ember particles ── */}
      {Array.from({ length: 18 }, (_, i) => (
        <div
          key={i}
          className={styles.ember}
          style={{
            left:              `${5 + i * 5.3}%`,
            animationDelay:    `${((i * 0.13) % 1.4).toFixed(2)}s`,
            animationDuration: `${(0.9 + (i % 5) * 0.22).toFixed(2)}s`,
            width:             `${2 + (i % 3)}px`,
            height:            `${2 + (i % 3)}px`,
          }}
        />
      ))}

      {/* ── Corner brackets — fly in from outside ── */}
      <div className={`${styles.corner} ${styles.tl}`}>
        <AlertTriangle size={20} className={styles.alertIcon} />
      </div>
      <div className={`${styles.corner} ${styles.tr}`} />
      <div className={`${styles.corner} ${styles.bl}`} />
      {/* Bottom-right: heartbeat pulse */}
      <div className={`${styles.corner} ${styles.br} ${styles.brPulse}`} />

      {/* ── Horizontal threat bars ── */}
      <div className={`${styles.threatBar} ${styles.threatTop}`} />
      <div className={`${styles.threatBar} ${styles.threatBot}`} />

      {/* ── Main content — slams in ── */}
      <div className={styles.content}>

        {/* Flame icons — breathe independently */}
        <div className={styles.iconRow}>
          <Flame size={30} className={`${styles.flameIcon} ${styles.flameL}`} />
          <AlertTriangle size={24} className={styles.triangleIcon} />
          <Flame size={30} className={`${styles.flameIcon} ${styles.flameR}`} />
        </div>

        {/* Title SLAMS in, then shakes */}
        <span className={styles.title}>COST MANAGER</span>

        {/* Subtitle — pulses / breathes */}
        <span className={styles.subtitle}>⚠ CRITICAL SYSTEMS ACTIVE ⚠</span>

        {/* Burn-fill progress bar */}
        <div className={styles.burnBarWrap}>
          <div className={styles.burnBar}>
            <div className={styles.burnFill} />
            <div className={styles.burnGlow} />
          </div>
        </div>

      </div>

    </div>
  );
}
