/**
 * Easing functions — extracted from the Omni loading-intro design handoff.
 * All easings take `t ∈ [0,1]` and return eased `t ∈ [0,1]` (back/elastic may overshoot).
 *
 * These are stock Popmotion-style curves. The handoff calls out exact curves per segment
 * (easeOutCubic, easeInQuart, etc.) — match them exactly when porting the animation.
 *
 * See docs/BRANDING.md "Loading intro exception" for where these are used.
 */

// Linear
export const linear = (t) => t;

// Quad
export const easeInQuad    = (t) => t * t;
export const easeOutQuad   = (t) => t * (2 - t);
export const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

// Cubic
export const easeInCubic    = (t) => t * t * t;
export const easeOutCubic   = (t) => { const u = t - 1; return u * u * u + 1; };
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1);

// Quart
export const easeInQuart    = (t) => t * t * t * t;
export const easeOutQuart   = (t) => { const u = t - 1; return 1 - u * u * u * u; };
export const easeInOutQuart = (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - 8 * Math.pow(t - 1, 4));

// Sine
export const easeInSine    = (t) => 1 - Math.cos((t * Math.PI) / 2);
export const easeOutSine   = (t) => Math.sin((t * Math.PI) / 2);
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

/**
 * Clamp a value to `[min, max]`. Returns NaN unchanged.
 */
export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Positional lerp: at time `t`, what's the eased value between (fromT, fromV) and (toT, toV)?
 *
 *   lerp(0.5, 0, 1, 100, 200)            → 150     (linear midpoint)
 *   lerp(0.5, 0, 1, 100, 200, easeInQuad) → 125    (eased midpoint)
 *   lerp(-1,  0, 1, 100, 200)            → 100     (clamped before fromT)
 *   lerp(99,  0, 1, 100, 200)            → 200     (clamped after toT)
 *
 * Used heavily by OmniLoading to drive ray draws, bloom intensity, dot scale, etc.
 */
export function lerp(t, fromT, toT, fromV, toV, ease = linear) {
  if (toT === fromT) return toV;
  if (t <= fromT) return fromV;
  if (t >= toT) return toV;
  const p = (t - fromT) / (toT - fromT);
  return fromV + (toV - fromV) * ease(p);
}
