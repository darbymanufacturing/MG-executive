import { useEffect, useState } from 'react';

/**
 * Reads `prefers-reduced-motion: reduce` from the user's OS settings.
 * Subscribes to changes so the value updates live if the user toggles it.
 *
 * Usage:
 *   const reduceMotion = useReducedMotion();
 *   if (reduceMotion) return <StaticLogo />;
 *
 * Used by `<OmniLoading>` to skip the cinematic intro and render the locked
 * Asterism mark with a 200ms fade instead. Per the loading-intro design
 * handoff's accessibility section — see docs/BRANDING.md.
 */
export default function useReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e) => setReduced(e.matches);
    // Older Safari uses addListener; modern uses addEventListener
    if (mq.addEventListener) {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  return reduced;
}
