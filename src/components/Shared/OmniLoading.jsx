import { useEffect, useRef, useState } from 'react';
import AsterismMark from './AsterismMark.jsx';
import useReducedMotion from '../../hooks/useReducedMotion.js';
import { easeOutCubic, easeOutQuad, easeInQuad, easeInQuart, lerp, clamp } from '../../utils/easings.js';
import styles from './OmniLoading.module.css';

/**
 * OmniLoading — the cinematic Asterism-assembly intro from the design handoff.
 *
 * The 2.0s intro plays once on every mount, then (if `loop`) transitions into
 * a subtle 1.2s "breath" segment that continues until the parent unmounts the
 * component. The "no animation in brand surfaces" rule (docs/BRANDING.md) has
 * an explicit exception carved out for this component — see the doc.
 *
 * Props:
 *   variant       — "splash" (full-bleed black backdrop + wordmark) | "compact" (transparent, inline)
 *   loop          — keep playing the breath loop after the 2s intro (default true)
 *   onComplete    — fired once when t crosses 2.0s
 *   size          — pixel size override; defaults: splash uses CSS (min 48vh,48vw), compact 96
 *   showWordmark  — render OMNI text (splash only — compact always hides)
 *   className     — appended to the container
 *
 * Per-handoff hard rules:
 *   - 2.0s total runtime — don't speed up
 *   - exact easing curves (easeOutCubic / easeInQuart / easeOutQuad / easeInQuad)
 *   - exact colors (rust #A0521D, ink #0F172A, cream #FFE3CC, etc.)
 *   - asymmetric ray lengths preserved (matches AsterismMark geometry)
 *   - `stroke-linecap: round` non-negotiable
 *   - `prefers-reduced-motion` → skip intro, static AsterismMark with 200ms fade
 */

// ─── Geometry (from asset/asterism.svg, 32×32 viewBox) ──────────────
// Inner endpoint → outer endpoint. Lines drawn from inner outward via
// stroke-dashoffset so they "grow" from the center dot. The orange north
// ray is drawn the opposite way (outer→inner) so it reads as streaking in
// from above. Geometry must match src/components/Shared/AsterismMark.jsx
// exactly so the locked frame cuts seamlessly to the static mark.
const INK_RAYS = [
  { id: 'ne', x1: 23.07, y1:  8.93, x2: 18.12, y2: 13.88, color: '#0F172A', w: 2.0 },
  { id: 'e',  x1: 30.00, y1: 16.00, x2: 19.00, y2: 16.00, color: '#0F172A', w: 2.5 },
  { id: 'se', x1: 22.72, y1: 22.72, x2: 18.12, y2: 18.12, color: '#0F172A', w: 2.0 },
  { id: 's',  x1: 16.00, y1: 31.00, x2: 16.00, y2: 19.00, color: '#0F172A', w: 2.5 },
  { id: 'sw', x1:  8.93, y1: 23.07, x2: 13.88, y2: 18.12, color: '#0F172A', w: 2.0 },
  { id: 'w',  x1:  1.50, y1: 16.00, x2: 13.00, y2: 16.00, color: '#0F172A', w: 2.5 },
  { id: 'nw', x1:  9.28, y1:  9.28, x2: 13.88, y2: 13.88, color: '#0F172A', w: 2.0 },
];
const NORTH = { x1: 16, y1: 0, x2: 16, y2: 13, color: '#A0521D', w: 2.5 };

// ─── Timeline constants (don't tweak — per design handoff) ──────────
const INTRO_DURATION   = 2.0;
const BREATH_DURATION  = 1.2;
const RAY_START        = 0.32;
const RAY_STAGGER      = 0.045;
const RAY_DUR          = 0.50;
const NORTH_START      = 1.00;
const NORTH_DUR        = 0.28;
const LOCK_T           = NORTH_START + NORTH_DUR; // 1.28
const FLASH_DUR        = 0.45;
const WORDMARK_FADE    = 0.22;
const WORDMARK_SLIDE   = 0.40;

// ─── Animated ray segment ────────────────────────────────────────────
function Ray({ x1, y1, x2, y2, color, w, t, dur, ease = easeOutCubic, glow = false }) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const p = clamp(t / dur, 0, 1);
  const eased = ease(p);
  const offset = len * (1 - eased);
  const tipFlash = p > 0 && p < 1 ? 1 : 0;
  return (
    <g>
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={color} strokeWidth={w} strokeLinecap="round"
        strokeDasharray={len} strokeDashoffset={offset}
        style={glow ? { filter: 'drop-shadow(0 0 0.6px #A0521D)' } : undefined}
      />
      {glow && tipFlash > 0 && (
        <circle
          cx={x1 + (x2 - x1) * eased}
          cy={y1 + (y2 - y1) * eased}
          r={0.9}
          fill="#FFE3CC"
          opacity={0.9}
          style={{ filter: 'drop-shadow(0 0 1.2px #FFB07A)' }}
        />
      )}
    </g>
  );
}

// ─── Compute every animated value for a given playhead t ─────────────
function frame(t) {
  // Camera zoom: 1.10 → 1.00 → 1.04 → 1.00
  let camZoom;
  if (t < 1.4)      camZoom = lerp(t, 0,   1.4,  1.10, 1.00, easeOutCubic);
  else if (t < 1.6) camZoom = lerp(t, 1.4, 1.6,  1.00, 1.04, easeOutQuad);
  else              camZoom = lerp(t, 1.6, 1.85, 1.04, 1.00, easeOutCubic);

  // Sienna bloom: builds during assembly, peaks at lock-in, gentle fade
  let bloom;
  if (t < 0.20)      bloom = 0;
  else if (t < 1.30) bloom = lerp(t, 0.20, 1.30, 0.05, 0.55, easeInQuad);
  else if (t < 1.45) bloom = lerp(t, 1.30, 1.45, 0.55, 1.00, easeOutQuad);
  else               bloom = lerp(t, 1.45, 2.00, 1.00, 0.60, easeOutCubic);

  // Center dot: scale 0 → 1.35 → 1.0 (punch + settle)
  let dotScale = 0;
  if (t >= 0.18) {
    const p1 = clamp((t - 0.18) / 0.18, 0, 1);
    if (p1 < 1) {
      dotScale = lerp(p1, 0, 1, 0, 1.35, easeOutCubic);
    } else {
      const p2 = clamp((t - 0.36) / 0.12, 0, 1);
      dotScale = p2 < 1 ? lerp(p2, 0, 1, 1.35, 1.0, easeOutQuad) : 1.0;
    }
  }

  // Punch ring (expanding circle at dot appearance)
  const ringP = clamp((t - 0.22) / 0.35, 0, 1);
  const ringR = lerp(ringP, 0, 1, 0, 9, easeOutCubic);
  const ringOpacity = ringP > 0 && ringP < 1 ? (1 - ringP) * 0.7 : 0;

  // North ray progress (used for tracer position)
  const northP = clamp((t - NORTH_START) / NORTH_DUR, 0, 1);
  const tracerY = lerp(northP, 0, 1, 0, 13, easeInQuart);
  const tracerVisible = northP > 0 && northP < 1;

  // Lock-in flash: peaks at 1.28s, decays over 0.45s with (1-p)^2.2
  let flash = 0;
  if (t >= LOCK_T) {
    const p = clamp((t - LOCK_T) / FLASH_DUR, 0, 1);
    flash = Math.pow(1 - p, 2.2);
  }

  // Wordmark: fade in over 0.22s, slide y 8→0 over 0.40s
  let wordmarkOpacity = 0;
  let wordmarkY = 8;
  if (t >= LOCK_T) {
    wordmarkOpacity = clamp((t - LOCK_T) / WORDMARK_FADE, 0, 1);
    wordmarkY = lerp(t, LOCK_T, LOCK_T + WORDMARK_SLIDE, 8, 0, easeOutCubic);
  }

  // Anticipation guide line
  let guideOpacity = 0;
  if (t >= 0.85 && t < NORTH_START) {
    const p = (t - 0.85) / (NORTH_START - 0.85);
    guideOpacity = p * 0.18;
  }

  // Mark base opacity
  const markOpacity = clamp((t - 0.20) / 0.10, 0, 1);

  return {
    camZoom, bloom, dotScale, ringR, ringOpacity,
    northP, tracerY, tracerVisible,
    flash, wordmarkOpacity, wordmarkY, guideOpacity, markOpacity,
  };
}

// ─── Breath loop frame: subtle dot pulse + bloom oscillation around locked state ─────
function breathFrame(breathT) {
  const cycle = (breathT % BREATH_DURATION) / BREATH_DURATION; // 0..1
  const sin01 = (Math.sin(cycle * 2 * Math.PI - Math.PI / 2) + 1) / 2; // 0..1 smooth
  const dotScale = 1.0 + 0.025 * sin01;
  const bloom = 0.55 + 0.15 * sin01;
  return {
    camZoom: 1.0,
    bloom,
    dotScale,
    ringR: 0, ringOpacity: 0,
    northP: 1, tracerY: 13, tracerVisible: false,
    flash: 0,
    wordmarkOpacity: 1, wordmarkY: 0,
    guideOpacity: 0,
    markOpacity: 1,
  };
}

// ─── Component ───────────────────────────────────────────────────────
export default function OmniLoading({
  variant = 'splash',
  loop = true,
  onComplete,
  size,
  showWordmark = true,
  className = '',
}) {
  const reducedMotion = useReducedMotion();
  // setTick forces a re-render on each RAF tick; the value itself is never read
  // (timeRef.current is the source of truth for animation state).
  // Underscore-prefix matches ESLint's allowed-unused pattern /^[A-Z_]/u.
  const [_tick, setTick] = useState(0);
  const timeRef = useRef(0);
  const startRef = useRef(null);
  const rafRef = useRef(null);
  const completedRef = useRef(false);

  // Drive the RAF loop. Plays intro 0→2s, then breath segment if loop is on.
  useEffect(() => {
    if (reducedMotion) {
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete?.();
      }
      return;
    }

    const step = (ts) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = (ts - startRef.current) / 1000;
      timeRef.current = elapsed;

      // Fire onComplete once when intro crosses 2.0s
      if (!completedRef.current && elapsed >= INTRO_DURATION) {
        completedRef.current = true;
        onComplete?.();
      }

      // Stop the RAF if we've finished the intro and aren't looping
      if (elapsed >= INTRO_DURATION && !loop) {
        setTick((n) => n + 1);
        return;
      }

      setTick((n) => n + 1);
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      startRef.current = null;
    };
    // tick is intentionally excluded — it's an output, not an input
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion, loop]);

  const isSplash = variant === 'splash';
  const renderWordmark = isSplash && showWordmark;

  // Reduced-motion fallback: static locked frame, no animation
  if (reducedMotion) {
    return (
      <div
        className={`${styles.container} ${isSplash ? styles.splash : styles.compact} ${styles.reducedMotion} ${className}`}
        role="status"
        aria-label="Loading"
      >
        <div className={styles.stage}>
          <AsterismMark size={size ?? (isSplash ? undefined : 96)} title="" />
          {renderWordmark && <div className={styles.wordmark}>OMNI</div>}
        </div>
      </div>
    );
  }

  const t = timeRef.current;
  const f = t < INTRO_DURATION ? frame(t) : breathFrame(t - INTRO_DURATION);

  const svgStyle = {
    opacity: f.markOpacity,
    overflow: 'visible',
    filter: `drop-shadow(0 0 ${12 + f.bloom * 18}px rgba(160, 82, 29, ${0.35 + f.bloom * 0.4}))`,
    width: size ? `${size}px` : undefined,
    height: size ? `${size}px` : undefined,
  };

  return (
    <div
      className={`${styles.container} ${isSplash ? styles.splash : styles.compact} ${className}`}
      role="status"
      aria-label="Loading"
    >
      {/* Splash-only backdrop layers — radial bloom + vignette + lock-in flash */}
      {isSplash && (
        <>
          <div
            className={styles.backdrop}
            style={{
              background: `radial-gradient(circle at 50% 50%,
                rgba(160, 82, 29, ${0.55 * f.bloom}) 0%,
                rgba(160, 82, 29, ${0.25 * f.bloom}) 18%,
                rgba(0, 0, 0, 0) 55%)`,
            }}
          />
          <div className={styles.vignette} />
          <div
            className={styles.flash}
            style={{
              background: `radial-gradient(circle at 50% 47%,
                rgba(255, 250, 240, ${f.flash}) 0%,
                rgba(255, 235, 210, ${f.flash * 0.6}) 18%,
                rgba(160, 82, 29, ${f.flash * 0.15}) 42%,
                rgba(0, 0, 0, 0) 70%)`,
            }}
          />
        </>
      )}

      {/* Logo stage — SVG (+ wordmark on splash) */}
      <div
        className={styles.stage}
        style={{ transform: `scale(${f.camZoom})`, transformOrigin: '50% 50%' }}
      >
        <svg
          viewBox="0 0 32 32"
          className={isSplash ? styles.svgSplash : styles.svgCompact}
          style={svgStyle}
          aria-hidden="true"
        >
          {f.ringOpacity > 0 && (
            <circle cx="16" cy="16" r={f.ringR} fill="none" stroke="#A0521D" strokeWidth={0.4} opacity={f.ringOpacity} />
          )}

          {f.guideOpacity > 0 && (
            <line
              x1="16" y1="0" x2="16" y2="13"
              stroke="#A0521D" strokeWidth={0.6}
              strokeDasharray="0.6 0.8"
              opacity={f.guideOpacity} strokeLinecap="round"
            />
          )}

          <g strokeLinecap="round" fill="none">
            {INK_RAYS.map((r, i) => (
              <Ray
                key={r.id}
                x1={r.x2} y1={r.y2}        // start at inner endpoint
                x2={r.x1} y2={r.y1}        // grow outward
                color={r.color} w={r.w}
                t={t - (RAY_START + i * RAY_STAGGER)}
                dur={RAY_DUR}
                ease={easeOutCubic}
              />
            ))}

            <Ray
              x1={NORTH.x1} y1={NORTH.y1}
              x2={NORTH.x2} y2={NORTH.y2}
              color={NORTH.color} w={NORTH.w}
              t={t - NORTH_START}
              dur={NORTH_DUR}
              ease={easeInQuart}
              glow
            />

            {f.tracerVisible && (
              <line
                x1="16" y1={Math.max(0, f.tracerY - 2.5)}
                x2="16" y2={f.tracerY + 0.5}
                stroke="#FFE3CC" strokeWidth={1.2} strokeLinecap="round"
                opacity={0.85}
                style={{ filter: 'drop-shadow(0 0 1.4px #FFB07A)' }}
              />
            )}
          </g>

          <circle cx="16" cy="16" r={2.2 * f.dotScale} fill="#0F172A" />
          {f.flash > 0 && (
            <circle cx="16" cy="16" r={2.2 * 0.45} fill="#A0521D" opacity={f.flash * 0.9} />
          )}
        </svg>

        {renderWordmark && (
          <div
            className={styles.wordmark}
            style={{
              opacity: f.wordmarkOpacity,
              transform: `translateY(${f.wordmarkY}px)`,
            }}
          >
            OMNI
          </div>
        )}
      </div>
    </div>
  );
}
