import * as Sentry from '@sentry/react';

/**
 * Initialise Sentry error capture for the Omni client.
 *
 * Enabled ONLY when a DSN is present AND this is a production build
 * (or VITE_SENTRY_FORCE === 'true' for a local prod-preview test) — so
 * everyday dev clicks and Firebase-emulator noise never burn the free-tier
 * error quota (5k events/mo).
 *
 * VITE_SENTRY_DSN is public-by-design: a DSN is a write-only ingest key
 * (it can SEND events, never read them), so it is safe to ship in the client
 * bundle — same reasoning as the Firebase web API key.
 *
 * Deliberately NOT enabled: Session Replay (would record financial + fleet
 * data) and heavy performance tracing (quota). This is error capture only.
 * Once initialised, Sentry auto-installs window.onerror + unhandledrejection
 * handlers, so uncaught errors and rejected promises are captured globally;
 * ErrorBoundary.componentDidCatch reports React render errors on top.
 */
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  const force = import.meta.env.VITE_SENTRY_FORCE === 'true';
  const enabled = Boolean(dsn) && (import.meta.env.PROD || force);
  if (!enabled) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    ignoreErrors: [
      // Benign browser noise that isn't actionable.
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications.',
    ],
  });
}
