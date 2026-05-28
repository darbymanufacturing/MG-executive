import { useState, useEffect } from 'react';
import styles from './PmeIntroOverlay.module.css';

/**
 * Full-screen radar intro overlay — sonar/radar reference design.
 * SVG radar structure (rings, bezel ticks, radial lines) + CSS sweep animation.
 * Auto-dismisses after 4 000ms. Click anywhere to skip.
 */

/* ── SVG radar face ─────────────────────────────────────────────────────── */
function RadarFace() {
  const cx = 300;
  const cy = 300;
  const outerR = 278;

  // ── Concentric rings ──
  const rings = [outerR, 208, 139, 70, 28];

  // ── Radial lines (every 30°) ──
  const radials = Array.from({ length: 12 }, (_, i) => {
    const angle = (i * 30 * Math.PI) / 180;
    return {
      x1: cx + 28 * Math.cos(angle),
      y1: cy + 28 * Math.sin(angle),
      x2: cx + outerR * Math.cos(angle),
      y2: cy + outerR * Math.sin(angle),
    };
  });

  // ── Bezel tick marks (every 10°, 36 total) ──
  const ticks = Array.from({ length: 36 }, (_, i) => {
    const deg = i * 10;
    const rad = (deg * Math.PI) / 180;
    const isCardinal  = deg % 90 === 0;        // 0,90,180,270 — longest
    const isMid       = deg % 45 === 0 && !isCardinal; // 45,135,225,315 — medium
    const len = isCardinal ? 14 : isMid ? 9 : 5;
    const r1 = outerR - len;
    const r2 = outerR;
    return {
      x1: cx + r1 * Math.cos(rad),
      y1: cy + r1 * Math.sin(rad),
      x2: cx + r2 * Math.cos(rad),
      y2: cy + r2 * Math.sin(rad),
      isCardinal,
    };
  });

  return (
    <svg
      className={styles.radarSvg}
      viewBox="0 0 600 600"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        {/* Radial gradient for outer ring glow */}
        <radialGradient id="radarGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#A0521D" stopOpacity="0.03" />
          <stop offset="70%"  stopColor="#A0521D" stopOpacity="0.01" />
          <stop offset="100%" stopColor="#A0521D" stopOpacity="0.08" />
        </radialGradient>
        {/* Clip to outer circle */}
        <clipPath id="radarClip">
          <circle cx={cx} cy={cy} r={outerR} />
        </clipPath>
      </defs>

      {/* Subtle radial background fill */}
      <circle cx={cx} cy={cy} r={outerR} fill="url(#radarGlow)" />

      {/* Radial lines */}
      {radials.map((l, i) => (
        <line
          key={`rad-${i}`}
          x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
          stroke="rgba(160,82,29,0.18)"
          strokeWidth="0.8"
        />
      ))}

      {/* Concentric rings */}
      {rings.map((r, i) => (
        <circle
          key={`ring-${i}`}
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={i === 0 ? 'rgba(0,255,120,0.6)' : 'rgba(0,255,120,0.22)'}
          strokeWidth={i === 0 ? 1.5 : 0.8}
        />
      ))}

      {/* Bezel ticks */}
      {ticks.map((t, i) => (
        <line
          key={`tick-${i}`}
          x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
          stroke={t.isCardinal ? 'rgba(0,255,120,0.9)' : 'rgba(0,255,120,0.55)'}
          strokeWidth={t.isCardinal ? 2 : 1}
        />
      ))}

      {/* Center crosshair */}
      <line x1={cx - 14} y1={cy} x2={cx + 14} y2={cy}
        stroke="rgba(0,255,120,0.6)" strokeWidth="1" />
      <line x1={cx} y1={cy - 14} x2={cx} y2={cy + 14}
        stroke="rgba(0,255,120,0.6)" strokeWidth="1" />
      <circle cx={cx} cy={cy} r={4}
        fill="none" stroke="rgba(0,255,120,0.8)" strokeWidth="1.2" />
      <circle cx={cx} cy={cy} r={1.5} fill="rgba(0,255,120,0.9)" />
    </svg>
  );
}

/* ── Main overlay ───────────────────────────────────────────────────────── */
export default function PmeIntroOverlay({ onDone }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(false);
      onDone?.();
    }, 4800);
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
      {/* ── Radar container ─────────────────────────────────────────────── */}
      <div className={styles.radarContainer}>

        {/* SVG static structure */}
        <RadarFace />

        {/* Rotating sweep arm — single element, bright leading edge + fade trail */}
        <div className={styles.sweepWrap}>
          <div className={styles.sweep} />
        </div>

        {/* ── Dot 1 — red, top-right ~50° ── */}
        <div className={`${styles.dotWrap} ${styles.dot1Wrap}`}>
          <div className={`${styles.dot} ${styles.dot1}`} />
          <div className={`${styles.ping} ${styles.ping1}`} />
          <span className={`${styles.label} ${styles.label1}`}>OVERTURNED</span>
        </div>

        {/* ── Dot 2 — amber, lower-left ~200° ── */}
        <div className={`${styles.dotWrap} ${styles.dot2Wrap}`}>
          <div className={`${styles.dot} ${styles.dot2}`} />
          <span className={`${styles.label} ${styles.label2}`}>Inspection in 2 weeks</span>
        </div>

        {/* ── Dot 3 — green, lower-right ~310° ── */}
        <div className={`${styles.dotWrap} ${styles.dot3Wrap}`}>
          <div className={`${styles.dot} ${styles.dot3}`} />
          <span className={`${styles.label} ${styles.label3}`}>Check OK</span>
        </div>

        {/* ── Centre text ─────────────────────────────────────────────── */}
        <div className={styles.centerContent}>
          <span className={styles.pmeTitle}>PME</span>
          <div className={styles.divider} />
          <span className={styles.pmeSubtitle}>Predictive Maintenance Module</span>
        </div>

      </div>

      {/* Skip hint */}
      <span className={styles.skipHint}>click anywhere to skip</span>
    </div>
  );
}
