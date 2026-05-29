/**
 * orgWrite / orgUpdate / orgDelete — the leak-proof WRITE half of the ADR-0003
 * org-scoped data layer. Every create auto-stamps `orgId` (from the active org
 * published by OrgProvider) + `createdByUid`, and stamps `createdAt`/`updatedAt`
 * with a server timestamp UNLESS the caller passes explicit values (e.g.
 * CostContext keeps ISO-string timestamps to match docs/SCHEMA.md and avoid a
 * mixed-type field). Routes through `safeWrite` so a failure toasts instead of
 * disappearing.
 *
 * `orgId` comes from a module singleton (published by OrgProvider via
 * `setActiveOrg`, mirroring the existing `setToastErrorHandler` pattern) so these
 * can stay standalone async functions per the ADR-0003 locked API:
 *
 *   await orgWrite('costs', data)               // create (auto id)
 *   await orgWrite('config', data, { id })      // upsert at an explicit id (replace)
 *   await orgWrite('costs', data, { id, merge: true })
 *   await orgUpdate('costs', docId, patch)      // patch + updatedAt
 *   await orgDelete('costs', docId)
 *
 * INVARIANT (ADR-0003): throws if there is no active orgId — it NEVER writes an
 * unscoped doc. Cross-org writes are additionally blocked server-side by the
 * Firestore rules (Phase 2.4); this layer makes a leak hard to write by accident.
 *
 * Returns the `safeWrite` result object: `{ ok, data }` or `{ ok: false, error }`
 * (or re-throws when `opts.rethrow` is set — passed straight through to safeWrite).
 */
import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';

let _orgId = null;

/** Published by OrgProvider whenever the active org changes (or null on sign-out). */
export function setActiveOrg(orgId) {
  _orgId = orgId || null;
}

/** Current active orgId (or null). Mostly for tests / debugging. */
export function getActiveOrg() {
  return _orgId;
}

function requireOrg(op) {
  if (!_orgId) {
    throw new Error(`orgWrite: no active orgId — "${op}" blocked (ADR-0003: never write unscoped).`);
  }
  return _orgId;
}

export async function orgWrite(collectionName, data, opts = {}) {
  const orgId = requireOrg(`create in ${collectionName}`);
  const { id, merge = false, ...writeOpts } = opts;
  const uid = auth.currentUser?.uid ?? null;
  const payload = {
    ...data,
    orgId,
    createdByUid: data.createdByUid ?? uid,
    createdAt: data.createdAt ?? serverTimestamp(),
    updatedAt: data.updatedAt ?? serverTimestamp(),
  };
  return safeWrite(
    () => (id
      ? setDoc(doc(db, collectionName, id), payload, { merge })
      : addDoc(collection(db, collectionName), payload)),
    { errorMessage: `Failed to save ${collectionName}`, ...writeOpts },
  );
}

export async function orgUpdate(collectionName, docId, patch, opts = {}) {
  requireOrg(`update ${collectionName}/${docId}`);
  // orgId is NOT re-stamped here (the doc already carries it from create); the
  // Firestore rules block patching another org's doc. We only guard that a write
  // never happens with no org in context.
  return safeWrite(
    () => updateDoc(doc(db, collectionName, docId), { ...patch, updatedAt: patch.updatedAt ?? serverTimestamp() }),
    { errorMessage: `Failed to update ${collectionName}`, ...opts },
  );
}

export async function orgDelete(collectionName, docId, opts = {}) {
  requireOrg(`delete ${collectionName}/${docId}`);
  return safeWrite(
    () => deleteDoc(doc(db, collectionName, docId)),
    { errorMessage: `Failed to delete ${collectionName}`, ...opts },
  );
}
