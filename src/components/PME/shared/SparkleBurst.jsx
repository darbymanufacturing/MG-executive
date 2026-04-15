/**
 * SparkleBurst — 6 coloured dots that fly outward from a centre point.
 * Mounts, runs its 600ms animation, then calls onDone to unmount.
 * position: fixed so it floats above everything.
 */
import { useEffect } from 'react';
import styles from './SparkleBurst.module.css';

const DOTS = [
  { angle: 0,   color: '#00C896' },
  { angle: 60,  color: '#F5A623' },
  { angle: 120, color: '#C97D49' },
  { angle: 180, color: '#00C896' },
  { angle: 240, color: '#F5A623' },
  { angle: 300, color: '#C97D49' },
];

export default function SparkleBurst({ x, y, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 650);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className={styles.burst} style={{ left: x, top: y }} aria-hidden>
      {DOTS.map((dot, i) => (
        <span
          key={i}
          className={styles.dot}
          style={{
            background:      dot.color,
            '--angle':       `${dot.angle}deg`,
            animationDelay:  `${i * 20}ms`,
          }}
        />
      ))}
    </div>
  );
}
