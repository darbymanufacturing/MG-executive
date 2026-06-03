import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// #551 — Import firebase eagerly inside a try so that a missing/invalid
// VITE_FIREBASE_WEB_API_KEY throws a catchable Error here instead of crashing
// the module graph silently and leaving #root blank. The dynamic import below
// is evaluated immediately (no await) — the throw propagates synchronously via
// the rejected module evaluation, which our try/catch on the static import of
// App.jsx cannot cover, so we wrap the render call instead.
//
// Implementation: we import App (which pulls in firebase.js) and catch any
// synchronous init error thrown during module evaluation. If firebase.js throws
// we render a minimal diagnostic panel into #root rather than a blank screen.

function renderConfigError(err) {
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = `
    <div style="
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      min-height:100vh;background:#0F172A;color:#F8FAFC;font-family:system-ui,sans-serif;
      padding:2rem;box-sizing:border-box;
    ">
      <div style="
        background:#1E293B;border:1px solid #DC2626;border-radius:12px;
        max-width:560px;width:100%;padding:2rem;
      ">
        <h1 style="margin:0 0 .75rem;font-size:1.25rem;color:#DC2626;">
          Configuration Error — App cannot start
        </h1>
        <p style="margin:0 0 1rem;font-size:.9rem;line-height:1.6;color:#CBD5E1;">
          A required environment variable is missing or invalid.
          The app needs a Firebase API key to run.
        </p>
        <pre style="
          background:#0F172A;border:1px solid #334155;border-radius:6px;
          padding:.75rem 1rem;font-size:.8rem;line-height:1.5;
          color:#FCA5A5;white-space:pre-wrap;word-break:break-word;margin:0;
        ">${String(err?.message ?? err)}</pre>
        <p style="margin:.75rem 0 0;font-size:.8rem;color:#64748B;">
          Add <code style="color:#93C5FD;">VITE_FIREBASE_WEB_API_KEY</code> to
          <code style="color:#93C5FD;">.env.local</code> (dev) or your Vercel
          environment variables (prod), then reload.
        </p>
      </div>
    </div>
  `;
}

let AppModule;
try {
  // Static-style import resolved at bundle time — any synchronous throw during
  // firebase.js module evaluation bubbles here on first load.
  AppModule = await import('./App.jsx');
} catch (err) {
  renderConfigError(err);
  // Also surface to Sentry / console so it is never silent
  console.error('[main] Fatal init error — app did not start:', err);
  throw err; // re-throw so Vite/browser devtools still surface it
}

const { default: App } = AppModule;

// initSentry after the import guard so it only runs when firebase is healthy.
const { initSentry } = await import('./lib/sentry.js');
initSentry();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
