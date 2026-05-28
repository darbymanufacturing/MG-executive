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

const firebaseConfig = {
  apiKey: "AIzaSyDo1mG2qucaWeD-rmtLhSgk2DddBz1yP4c",
  authDomain: "mg-executive.firebaseapp.com",
  projectId: "mg-executive",
  storageBucket: "mg-executive.firebasestorage.app",
  messagingSenderId: "344679740633",
  appId: "1:344679740633:web:d2488b87d5a5abc9363ac8",
};

// Guard against re-initialization during Vite HMR
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// initializeFirestore can only be called once per app instance.
// On HMR reloads the app already exists, so fall back to getFirestore().
function getDb(app) {
  try {
    return initializeFirestore(app, {
      cache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(app);
  }
}

export const db      = getDb(app);
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
const USE_EMULATOR =
  import.meta.env.DEV && import.meta.env.VITE_USE_PROD_FIRESTORE !== 'true';

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
  console.info(
    '%c[firebase] 🧪 LOCAL EMULATOR%c Firestore :8080 · Auth :9099 · UI http://localhost:4000',
    'background:#A0521D;color:#fff;padding:2px 6px;border-radius:3px;font-weight:600',
    'color:#A0521D',
  );
} else if (import.meta.env.DEV) {
  console.warn(
    '%c[firebase] ⚠️ PROD FIRESTORE%c VITE_USE_PROD_FIRESTORE=true — dev clicks WILL burn production quota',
    'background:#DC2626;color:#fff;padding:2px 6px;border-radius:3px;font-weight:600',
    'color:#DC2626',
  );
}

/* ─── Firestore collection name constants ─── */
export const COLLECTIONS = {
  /* Existing */
  COSTS:               'costs',
  REVENUE:             'revenue',
  TICKETS:             'tickets',
  PARTS:               'parts',
  SCOOTERS:            'scooters',
  PROJECTS:            'projects',
  BRAINSTORM:          'brainstorm',
  GATES:               'gates',
  DIARY:               'diary',
  USERS:               'users',
  REPAIR_PROCEDURES:   'repair_procedures',
  REPAIR_SESSIONS:     'repair_sessions',
  TRIPS:               'trips',

  /* Omni Phase 1 — new */
  ISSUES:              'issues',
  NOTIFICATIONS:       'notifications',
  BRIEFS:              'briefs',
  ACCOUNTANT_FORWARDS: 'accountant_forwards',
};
