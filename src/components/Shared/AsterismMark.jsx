/**
 * AsterismMark — the Omni brand mark.
 *
 * Eight asymmetric rays radiating from a center dot. The north (12 o'clock)
 * ray is rendered in the brand accent (rust #A0521D); the other seven and the
 * center dot are ink (#0F172A). On dark surfaces, pass `fg="#FFFFFF"` (the
 * rust ray stays rust). For favicons or single-color contexts use `mono`.
 *
 * The asymmetric ray lengths are DELIBERATE — don't normalize them, that's
 * what kills the "compass rose / sparkle" reading. See docs/BRANDING.md.
 *
 * Props:
 *   size      — pixel width/height (default 32)
 *   mono      — render entire mark in `currentColor` (favicons, embeds). Default false.
 *   fg        — ink color override. Accepts CSS vars (e.g. "var(--fg-strong)") for
 *               theme-aware rendering. Default "#0F172A".
 *   accent    — rust color override. Default "#A0521D".
 *   title     — accessible name (default "Omni"). Pass empty string to mark decorative.
 */

const INK_DEFAULT  = '#0F172A';
const RUST_DEFAULT = '#A0521D';

export default function AsterismMark({
  size = 32,
  mono = false,
  fg,
  accent,
  title = 'Omni',
  className,
  ...rest
}) {
  const ink = mono ? 'currentColor' : (fg ?? INK_DEFAULT);
  const hot = mono ? 'currentColor' : (accent ?? RUST_DEFAULT);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      className={className}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <g strokeLinecap="round" fill="none">
        {/* rust — 12 o'clock (north) */}
        <line x1="16"    y1="13"    x2="16"    y2="0"     stroke={hot} strokeWidth="2.5" />
        {/* ink — clockwise from 1:30 */}
        <line x1="18.12" y1="13.88" x2="23.07" y2="8.93"  stroke={ink} strokeWidth="2" />
        <line x1="19"    y1="16"    x2="30"    y2="16"    stroke={ink} strokeWidth="2.5" />
        <line x1="18.12" y1="18.12" x2="22.72" y2="22.72" stroke={ink} strokeWidth="2" />
        <line x1="16"    y1="19"    x2="16"    y2="31"    stroke={ink} strokeWidth="2.5" />
        <line x1="13.88" y1="18.12" x2="8.93"  y2="23.07" stroke={ink} strokeWidth="2" />
        <line x1="13"    y1="16"    x2="1.5"   y2="16"    stroke={ink} strokeWidth="2.5" />
        <line x1="13.88" y1="13.88" x2="9.28"  y2="9.28"  stroke={ink} strokeWidth="2" />
      </g>
      <circle cx="16" cy="16" r="2.2" fill={ink} />
    </svg>
  );
}
