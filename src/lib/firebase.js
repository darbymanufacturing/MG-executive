import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

// #551 — Validate required env var before any Firebase SDK call so a missing
// VITE_FIREBASE_WEB_API_KEY throws a clear, catchable Error (caught in main.jsx)
// instead of an opaque Firebase-internal exception that leaves #root blank.
const _apiKey = import.meta.env.VITE_FIREBASE_WEB_API_KEY;
if (!_apiKey) {
  throw new Error(
    '[firebase] VITE_FIREBASE_WEB_API_KEY is not set. ' +
    'Add it to your .env.local (dev) or Vercel environment variables (prod). ' +
    'The app cannot start without a valid Firebase API key.'
  );
}

const firebaseConfig = {
  apiKey: _apiKey,
  authDomain: "mg-executive.firebaseapp.com",
  projectId: "mg-executive",
  storageBucket: "mg-executive.firebasestorage.app",
  messagingSenderId: "344679740633",
  appId: "1:344679740633:web:d2488b87d5a5abc9363ac8",
};

// Guard against re-initialization during Vite HMR
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// ── Emulator flag computed BEFORE getDb so the db init can skip persistentLocalCache.
// persistentLocalCache immediately begins syncing IndexedDB against the production
// endpoint; enabling it in emulator mode lets that in-flight sync race the
// connectFirestoreEmulator redirect (bug #334). Omitting it in emulator mode is safe:
// emulator sessions are ephemeral and don't need persisted cache.
const USE_EMULATOR =
  import.meta.env.DEV && import.meta.env.VITE_USE_PROD_FIRESTORE !== 'true';

// initializeFirestore can only be called once per app instance.
// On HMR reloads the app already exists, so fall back to getFirestore().
function getDb(app, useEmulator) {
  try {
    if (useEmulator) {
      // No persistent cache in emulator mode — prevents any production-endpoint sync
      // from racing the connectFirestoreEmulator call below.
      return initializeFirestore(app, {});
    }
    return initializeFirestore(app, {
      cache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(app);
  }
}

export const db      = getDb(app, USE_EMULATOR);
export const auth    = getAuth(app);
export const storage = getStorage(app);

// ─────────────────────────────────────────────────────────────────────────────
// Local Firebase Emulator — see docs/QUICKSTART.md "Local Firebase Emulator"
//
// In DEV mode we default to the local emulator suite so dev clicks don't burn
// production Firestore quota. To bypass and hit real production Firestore from
// `npm run dev` (e.g., debugging a real-data issue), set this in .env.local:
//
//   VITE_USE_PROD_FIRESTORE=true
//
// Production builds (`npm run build` / Vercel) never connect to the emulator;
// `import.meta.env.DEV` is false in those.
// ─────────────────────────────────────────────────────────────────────────────
// (USE_EMULATOR is declared above, before getDb — see #334 fix comment.)

if (USE_EMULATOR) {
  // Both connect calls throw if invoked twice on the same instance. HMR can
  // re-execute this module, so swallow the re-connect error rather than
  // bricking the dev session.
  try {
    connectFirestoreEmulator(db, 'localhost', 8080);
  } catch (e) {
    if (!String(e?.message ?? '').includes('already')) {
      console.warn('[firebase] connectFirestoreEmulator failed:', e);
    }
  }
  try {
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  } catch (e) {
    if (!String(e?.message ?? '').includes('already')) {
      console.warn('[firebase] connectAuthEmulator failed:', e);
    }
  }
  // #335 — probe the emulator UI to confirm it is actually running before printing
  // the "success" banner. connectFirestoreEmulator() does not check connectivity;
  // if the emulator is not up, the banner was misleading and every Firestore call
  // would silently fail with ECONNREFUSED.
  ;(async () => {
    try {
      await fetch('http://localhost:4000', { signal: AbortSignal.timeout(1500) });
      console.info(
        '%c[firebase] 🧪 LOCAL EMULATOR%c Firestore :8080 · Auth :9099 · UI http://localhost:4000',
        'background:#A0521D;color:#fff;padding:2px 6px;border-radius:3px;font-weight:600',
        'color:#A0521D',
      );
    } catch {
      console.warn(
        '%c[firebase] 🧪 LOCAL EMULATOR — NOT RUNNING%c Did you forget `npm run emulator`? All Firestore/Auth calls will fail.',
        'background:#DC2626;color:#fff;padding:2px 6px;border-radius:3px;font-weight:600',
        'color:#DC2626',
      );
    }
  })().catch(() => {});
} else if (import.meta.env.DEV) {
  console.warn(
    '%c[firebase] ⚠️ PROD FIRESTORE%c VITE_USE_PROD_FIRESTORE=true — dev clicks WILL burn production quota',
    'background:#DC2626;color:#fff;padding:2px 6px;border-radius:3px;font-weight:600',
    'color:#DC2626',
  );
}

// #93 — COLLECTIONS constant removed. Values were stale (e.g. 'tickets' instead of
// 'maintenanceTickets', 'parts' instead of 'maintenanceParts') and nothing imported
// this export. Collection name constants now live as COL vars in each context file.
