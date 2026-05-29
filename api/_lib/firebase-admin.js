/**
 * Firebase Admin SDK singleton — used by serverless functions that need
 * server-side Firestore writes or to verify Firebase Auth ID tokens.
 *
 * Init pattern: Vercel reuses Lambda instances across requests ("warm starts"),
 * so calling `admin.initializeApp()` twice throws. We check `admin.apps.length`
 * to avoid that, and we cache the credential parse so we don't re-parse the
 * service-account JSON on every warm invocation.
 *
 * Required env vars (set in Vercel dashboard, Production + Preview):
 *   FIREBASE_SERVICE_ACCOUNT_KEY  — full JSON string of the service-account key
 *                                   (download from Firebase Console → Service Accounts)
 *
 * Used by:
 *   api/cron-hopp-sync.js — both for verifyIdToken (manual-trigger auth) and db writes
 *
 * See docs/SECURITY.md "Secrets inventory" for rotation procedure.
 */

import admin from 'firebase-admin';

let _initialized = false;

function init() {
  if (_initialized) return;
  if (admin.apps && admin.apps.length > 0) {
    _initialized = true;
    return;
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_KEY env var is not set. ' +
      'Download the service account JSON from Firebase Console → Project Settings → ' +
      'Service Accounts → Generate new private key, then paste the entire JSON into ' +
      'the Vercel env var.'
    );
  }

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON. ' +
      'Paste the entire service-account .json file contents as the env var value.'
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert(credentials),
    projectId: credentials.project_id,
  });
  _initialized = true;
}

/** Lazily-initialized Firestore admin instance. */
export function getDb() {
  init();
  return admin.firestore();
}

/** Lazily-initialized Auth admin instance. */
export function getAuth() {
  init();
  return admin.auth();
}

/**
 * Verify a Firebase Auth ID token sent by a logged-in user.
 * Returns the decoded token (with uid, email, etc.) or throws.
 *
 *   const decoded = await verifyIdToken(req.headers.authorization?.replace(/^Bearer /, ''));
 *   if (decoded.uid !== expectedUid) throw new Error('uid mismatch');
 */
export async function verifyIdToken(token) {
  if (!token) throw new Error('Missing Firebase ID token');
  return getAuth().verifyIdToken(token);
}

/** Re-export the admin namespace for things like `FieldValue.serverTimestamp()` and `increment()`. */
export { admin };

/** Convenience: serverTimestamp + FieldValue helpers for batch writes. */
export const FieldValue = admin.firestore.FieldValue;
