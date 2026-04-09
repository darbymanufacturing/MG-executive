import { useState, useEffect } from 'react';
import { TrendingUp, Euro } from 'lucide-react';
import styles from './RevenueIntroOverlay.module.css';

/** Euro-rain characters spread across the screen */
const EUROS = Array.from({ length: 16 }, (_, i) => ({
  left:     `${3 + i * 5.9}%`,
  delay:    `${((i * 0.19) % 1.5).toFixed(2)}s`,
  duration: `${(1.6 + (i % 6) * 0.25).toFixed(2)}s`,
  fontSize: `${0.65 + (i % 4) * 0.18}rem`,
  opacity:  (0.035 + (i % 5) * 0.012).toFixed(3),
}));

/** Rising bar-chart pillars at the bottom */
const BARS = Array.from({ length: 11 }, (_, i) => ({
  height:  `${16 + ((i * 7 + 11) % 5) * 10}%`,
  delay:   `${(i * 0.055).toFixed(3)}s`,
  left:    `${(i / 11) * 86 + 7}%`,
}));

export default function RevenueIntroOverlay({ onDone }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => { setVisible(false); onDone?.(); }, 1700);
    return () => clearTimeout(t);
  }, [onDone]);

  if (!visible) return null;

  return (
    <div className={styles.overlay}>

      {/* ── Perspective grid ── */}
      <div className={styles.grid} />

      {/* ── Euro rain ── */}
      {EUROS.map((e, i) => (
        <span
          key={i}
          className={styles.euroRain}
          style={{
            left:           e.left,
            animationDelay:    e.delay,
            animationDuration: e.duration,
            fontSize:          e.fontSize,
            opacity:           e.opacity,
          }}
        >
          €
        </span>
      ))}

      {/* ── Rising bar-chart at bottom ── */}
      <div className={styles.barsContainer}>
        {BARS.map((b, i) => (
          <div
            key={i}
            className={styles.barPillar}
            style={{
              height:            b.height,
              left:              b.left,
              animationDelay:    b.delay,
            }}
          />
        ))}
      </div>

      {/* ── Scanline sweep ── */}
      <div className={styles.scanline} />

      {/* ── Horizontal golden divider lines ── */}
      <div className={`${styles.divider} ${styles.dividerTop}`} />
      <div className={`${styles.divider} ${styles.dividerBot}`} />

      {/* ── Corner brackets (gold) ── */}
      <div className={`${styles.corner} ${styles.tl}`} />
      <div className={`${styles.corner} ${styles.tr}`} />
      <div className={`${styles.corner} ${styles.bl}`} />
      <div className={`${styles.corner} ${styles.br}`} />

      {/* ── E92 M3 silhouette sweep ── */}
      <div className={styles.carWrap}>
        <svg
          className={styles.car}
          viewBox="0 0 560 140"
          xmlns="http://www.w3.org/2000/svg"
          fill="currentColor"
        >
          {/* Body */}
          <path d="
            M 14,110
            L 14,78
            Q 20,50 50,34
            Q 76,20 122,17
            Q 152,9  195,12
            Q 238,5  280,13
            Q 328,17 368,42
            Q 405,62 438,70
            L 455,64
            Q 462,62 468,68
            L 474,80
            L 476,98
            Q 470,114 450,116
            Q 424,116 406,102
            Q 388,88  362,88
            Q 336,88  318,102
            Q 300,116 268,116
            L 200,116
            Q 172,116 150,102
            Q 130,88  106,88
            Q 82,88   64,102
            Q 46,116  28,116
            Q 18,116 14,110
            Z
          " />
          {/* Front wheel */}
          <circle cx="106" cy="103" r="23" fill="none" strokeWidth="3.5" stroke="currentColor" />
          <circle cx="106" cy="103" r="8"  />
          {/* Rear wheel */}
          <circle cx="362" cy="103" r="23" fill="none" strokeWidth="3.5" stroke="currentColor" />
          <circle cx="362" cy="103" r="8"  />
          {/* Dual exhausts */}
          <rect x="466" y="97"  width="10" height="5" rx="2.5" />
          <rect x="466" y="104" width="10" height="5" rx="2.5" />
          {/* Subtle trunk lip */}
          <rect x="450" y="62" width="18" height="4" rx="2" />
        </svg>
      </div>

      {/* ── Main content — assembles in pieces ── */}
      <div className={styles.content}>

        {/* Subtitle slides DOWN from above */}
        <span className={styles.subtitle}>PERFORMANCE ANALYTICS</span>

        {/* Icon row — spread from center */}
        <div className={styles.iconRow}>
          <Euro size={28} className={styles.euroIcon} />
          <div className={styles.iconDivider} />
          <TrendingUp size={28} className={styles.trendIcon} />
        </div>

        {/* Title RISES from below */}
        <span className={styles.title}>REVENUE</span>

        {/* Fuel-gauge progress bar */}
        <div className={styles.gaugeWrap}>
          <span className={styles.gaugeLabel}>0</span>
          <div className={styles.gauge}>
            <div className={styles.gaugeFill} />
          </div>
          <span className={styles.gaugeLabel}>MAX</span>
        </div>

      </div>

    </div>
  );
}
