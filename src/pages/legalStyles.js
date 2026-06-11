/**
 * Shared inline styles for the public legal pages (#12 — Privacy Policy, Terms).
 * These pages render outside the admin shell, so they are self-styled with brand tokens.
 */
export const legalStyles = {
  page: {
    minHeight: '100vh',
    background: 'var(--xs-bg, #F8FAFC)',
    padding: '32px 16px',
    display: 'flex',
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 760,
    background: 'var(--surface, #fff)',
    border: '1px solid var(--color-border, #E2E8F0)',
    borderRadius: 'var(--radius-lg, 14px)',
    padding: 'clamp(20px, 5vw, 48px)',
    color: 'var(--fg-strong, #0F172A)',
    fontFamily: 'var(--font-body, system-ui, sans-serif)',
    lineHeight: 1.6,
  },
  back: { color: 'var(--accent, #A0521D)', textDecoration: 'none', fontSize: 14, fontWeight: 600 },
  h1: { fontSize: 'clamp(24px, 5vw, 34px)', margin: '16px 0 4px', color: 'var(--fg-strong, #0F172A)' },
  meta: { fontSize: 13, color: 'var(--fg-muted, #64748B)', margin: '0 0 20px' },
  draftNote: {
    background: 'rgba(217,119,6,0.12)',
    border: '1px solid rgba(217,119,6,0.35)',
    color: '#9A5B00',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 13,
    margin: '0 0 24px',
  },
  h2: { fontSize: 18, margin: '24px 0 8px', color: 'var(--accent, #A0521D)' },
  p: { fontSize: 15, margin: '0 0 12px' },
  ul: { fontSize: 15, margin: '0 0 12px', paddingLeft: 20 },
  a: { color: 'var(--accent, #A0521D)', fontWeight: 600 },
  footer: { fontSize: 14, marginTop: 28, paddingTop: 16, borderTop: '1px solid var(--color-border, #E2E8F0)', color: 'var(--fg-muted, #64748B)' },
};
