import { useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { PenLine, Check } from 'lucide-react';
import styles from './SignaturePad.module.css';

/**
 * SignaturePad — canvas signature capture for the F3 repair sign-off.
 * Ported from the design handoff (`design_handoff_crew_portal/src/crew-repair.jsx`):
 * pointer + touch drawing, "has ink" gating, Clear. Extended for production:
 * exposes `toBlob()` / `isEmpty()` via ref so the parent can upload the signature
 * PNG to Cloudinary on submit. Tells the parent about ink changes via onSignedChange
 * so it can gate the "Complete repair" button.
 */
const SignaturePad = forwardRef(function SignaturePad({ onSignedChange }, ref) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const ctxRef = useRef(null);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * ratio;
    c.height = rect.height * ratio;
    const ctx = c.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = getComputedStyle(c).getPropertyValue('--ink-stroke').trim() || '#0F172A';
    ctxRef.current = ctx;
  }, []);

  useImperativeHandle(ref, () => ({
    isEmpty: () => !hasInk,
    toBlob: () =>
      new Promise((resolve, reject) => {
        const c = canvasRef.current;
        if (!c || !hasInk) { resolve(null); return; }
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('signature canvas empty'))), 'image/png');
      }),
  }), [hasInk]);

  const posOf = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  };
  const start = (e) => {
    e.preventDefault();
    drawing.current = true;
    const { x, y } = posOf(e);
    ctxRef.current.beginPath();
    ctxRef.current.moveTo(x, y);
  };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const { x, y } = posOf(e);
    ctxRef.current.lineTo(x, y);
    ctxRef.current.stroke();
    if (!hasInk) { setHasInk(true); onSignedChange?.(true); }
  };
  const end = () => { drawing.current = false; };
  const clear = () => {
    const c = canvasRef.current;
    ctxRef.current.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
    onSignedChange?.(false);
  };

  return (
    <div>
      <div className={`${styles.pad} ${hasInk ? styles.padInked : ''}`}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        />
        {!hasInk && (
          <div className={styles.placeholder}>
            <PenLine size={22} />
            <span>Sign here with your finger</span>
          </div>
        )}
        <div className={styles.baseline} />
      </div>
      <div className={styles.footer}>
        <span className={hasInk ? styles.signedLabel : styles.hintLabel}>
          {hasInk ? <><Check size={12} /> Signed</> : 'Required before submitting'}
        </span>
        {hasInk && (
          <button type="button" className={styles.clearBtn} onClick={clear}>Clear</button>
        )}
      </div>
    </div>
  );
});

export default SignaturePad;
