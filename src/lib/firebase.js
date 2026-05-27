import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
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
