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
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, runTransaction,
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';
import { layerFor } from '../lib/dataLayerConfig.js';
import { sbWrite, sbUpsertMerge, sbUpdate, sbDelete, sbTransaction } from '../lib/supabaseWrite.js';

let _orgId = null;
let _userUid = null;

/**
 * Published by OrgProvider whenever the active org changes (or null on sign-out).
 * Accepts both orgId and uid atomically so neither can diverge during auth transitions
 * (fix for bug #425 — stale auth.currentUser read race window).
 */
export function setActiveOrg(orgId, uid = null) {
  _orgId = orgId || null;
  _userUid = uid ?? null;
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

/**
 * Verifies that `docId` belongs to the active org using the composite-id
 * convention (orgId + '_' + localId) established across the codebase.
 * Throws loudly if the prefix doesn't match — same pattern as requireOrg.
 * This is a synchronous, free check (no Firestore round-trip) that catches
 * cross-org writes before they reach the network (bug #424 / ADR-0003).
 */
function requireOrgDoc(op, docId) {
  const orgId = requireOrg(op);
  if (!docId.startsWith(orgId + '_')) {
    throw new Error(`orgWrite: docId "${docId}" does not belong to active org "${orgId}" — "${op}" blocked (ADR-0003).`);
  }
  return orgId;
}

export async function orgWrite(collectionName, data, opts = {}) {
  const { id, merge = false, ...writeOpts } = opts;
  const orgId = id
    ? requireOrgDoc(`create in ${collectionName}`, id)
    : requireOrg(`create in ${collectionName}`);
  const uid = _userUid;
  // ADR-0015 seam: Supabase create / upsert. merge:true at an explicit id =
  // create-or-shallow-merge (Firestore setDoc merge parity, no jsonb clobber).
  if (layerFor(collectionName) === 'supabase') {
    return safeWrite(
      () => (id && merge
        ? sbUpsertMerge(collectionName, orgId, uid, id, data)
        : sbWrite(collectionName, orgId, uid, data, { id })),
      { errorMessage: `Failed to save ${collectionName}`, ...writeOpts },
    );
  }
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
  const orgId = requireOrg(`update ${collectionName}/${docId}`);
  // ADR-0015 seam: Supabase patch (shallow data||patch, arrayUnion→$append).
  if (layerFor(collectionName) === 'supabase') {
    return safeWrite(
      () => sbUpdate(collectionName, orgId, docId, patch),
      { errorMessage: `Failed to update ${collectionName}`, ...opts },
    );
  }
  // orgId is NOT re-stamped here (the doc already carries it from create); the
  // Firestore rules block patching another org's doc. We only guard that a write
  // never happens with no org in context.
  return safeWrite(
    () => updateDoc(doc(db, collectionName, docId), { ...patch, updatedAt: patch.updatedAt ?? serverTimestamp() }),
    { errorMessage: `Failed to update ${collectionName}`, ...opts },
  );
}

export async function orgDelete(collectionName, docId, opts = {}) {
  const orgId = requireOrg(`delete ${collectionName}/${docId}`);
  if (layerFor(collectionName) === 'supabase') {
    return safeWrite(
      () => sbDelete(collectionName, orgId, docId),
      { errorMessage: `Failed to delete ${collectionName}`, ...opts },
    );
  }
  return safeWrite(
    () => deleteDoc(doc(db, collectionName, docId)),
    { errorMessage: `Failed to delete ${collectionName}`, ...opts },
  );
}

/**
 * Atomically read + mutate a project doc using a Firestore transaction.
 * `mutator(data)` receives the current Firestore doc data (or {} if the doc
 * doesn't exist) and must return the fields to merge back (plain object, NOT
 * the full doc). `updatedAt` is stamped automatically.
 *
 * Firestore retries contending transactions up to 5 times, so concurrent
 * writes from multiple tabs are serialized correctly — no stale read-modify-write.
 * Throws on network failure (matches orgUpdate rethrow:true behaviour).
 */
export async function orgTransaction(collectionName, docId, mutator) {
  const orgId = requireOrg(`transaction on ${collectionName}/${docId}`);
  // ADR-0015 seam: Supabase optimistic RMW (rmw_read → mutator → rmw_commit CAS).
  if (layerFor(collectionName) === 'supabase') {
    return sbTransaction(collectionName, orgId, docId, mutator);
  }
  const ref = doc(db, collectionName, docId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists() ? snap.data() : {};
    const patch = await mutator(data);
    tx.update(ref, { ...patch, updatedAt: serverTimestamp() });
  });
}
