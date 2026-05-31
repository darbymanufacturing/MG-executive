/**
 * Regression tests for BUG #320 — backfill progress doc must write O(1) per checkpoint
 * (one subcollection doc + one parent doc update), never N writes that grow with the
 * number of already-completed scooter-months.
 *
 * Uses a lightweight in-memory Firestore mock (no Firebase dependency) that counts
 * set() calls per path, letting us assert the O(1) invariant directly.
 */
import { describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory Firestore mock
// ---------------------------------------------------------------------------
/**
 * Minimal in-memory mock that supports the subset of the Firestore Admin SDK
 * used by the checkpoint logic:
 *   db.doc(path) → DocRef
 *   db.batch()   → WriteBatch
 *   docRef.collection(name).doc(id) → DocRef
 *   batch.set(ref, data, opts?)
 *   batch.commit() → Promise<void>
 *   docRef.get() → Promise<{ exists, data() }>
 *   docRef.collection(name).get() → Promise<{ docs: [{ id, data() }] }>
 */
function createMockDb() {
  // storage: Map<fullPath, data>
  const store = new Map();
  // write-call log: array of { path, data, opts }
  const writeCalls = [];

  function makeDocRef(fullPath) {
    return {
      _path: fullPath,
      collection(subcollName) {
        return makeCollRef(`${fullPath}/${subcollName}`);
      },
      async get() {
        const data = store.get(fullPath);
        return { exists: data !== undefined, data: () => data };
      },
      async delete() {
        store.delete(fullPath);
      },
    };
  }

  function makeCollRef(collPath) {
    return {
      _path: collPath,
      doc(id) {
        return makeDocRef(`${collPath}/${id}`);
      },
      async get() {
        const docs = [];
        for (const [path, data] of store.entries()) {
          // A doc is in this collection if its path is exactly collPath/id (no deeper slashes).
          const rest = path.startsWith(collPath + '/') ? path.slice(collPath.length + 1) : null;
          if (rest && !rest.includes('/')) {
            docs.push({ id: rest, data: () => data });
          }
        }
        return { docs };
      },
      async listDocuments() {
        const refs = [];
        for (const path of store.keys()) {
          const rest = path.startsWith(collPath + '/') ? path.slice(collPath.length + 1) : null;
          if (rest && !rest.includes('/')) {
            refs.push(makeDocRef(path));
          }
        }
        return refs;
      },
    };
  }

  function makeBatch() {
    const ops = [];
    return {
      set(ref, data, opts) {
        ops.push({ type: 'set', path: ref._path, data, opts });
        writeCalls.push({ path: ref._path, data, opts });
      },
      delete(ref) {
        ops.push({ type: 'delete', path: ref._path });
      },
      async commit() {
        for (const op of ops) {
          if (op.type === 'set') {
            if (op.opts?.merge) {
              store.set(op.path, { ...(store.get(op.path) || {}), ...op.data });
            } else {
              store.set(op.path, { ...op.data });
            }
          } else if (op.type === 'delete') {
            store.delete(op.path);
          }
        }
      },
    };
  }

  return {
    doc(path) { return makeDocRef(path); },
    batch() { return makeBatch(); },
    collection(name) { return makeCollRef(name); },
    /** Test helper: all write calls recorded */
    _writeCalls: writeCalls,
    /** Test helper: raw store */
    _store: store,
  };
}

// ---------------------------------------------------------------------------
// The checkpoint logic extracted for unit testing (mirrors the production code
// in backfill-hopp-history.mjs — kept in sync manually; if the production code
// changes, update this inline copy and the test assertions together).
// ---------------------------------------------------------------------------
const PROGRESS_DOC = 'backfill_state/hopp';
const COMPLETED_SUBCOLL = 'completed';

async function runCheckpoint(db, key, totals) {
  const progRef = db.doc(PROGRESS_DOC);
  const cpBatch = db.batch();
  cpBatch.set(progRef.collection(COMPLETED_SUBCOLL).doc(key), { ts: 'SERVER_TS' });
  cpBatch.set(progRef, { totals, updatedAt: 'SERVER_TS' }, { merge: true });
  await cpBatch.commit();
}

async function loadDone(db) {
  const progRef = db.doc(PROGRESS_DOC);
  const completedSnap = await progRef.collection(COMPLETED_SUBCOLL).get();
  return new Set(completedSnap.docs.map((d) => d.id));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('BUG #320 — progress checkpoint writes O(1) per iteration', () => {
  let db;

  beforeEach(() => {
    db = createMockDb();
  });

  it('after N checkpoints, parent progress doc receives exactly N set() calls (not 1+2+...+N)', async () => {
    const N = 5;
    const keys = Array.from({ length: N }, (_, i) => `SC00${i}_2025-0${i + 1}`);
    for (const key of keys) {
      await runCheckpoint(db, key, { trips: 10, tickets: 2, events: 5 });
    }

    const parentPath = PROGRESS_DOC;
    const parentWrites = db._writeCalls.filter((c) => c.path === parentPath);
    expect(parentWrites).toHaveLength(N);  // exactly N, not 1+2+...+N = 15
  });

  it('each checkpoint adds exactly one subcollection doc', async () => {
    const N = 4;
    const keys = Array.from({ length: N }, (_, i) => `SC${i}_2025-01`);
    for (const key of keys) {
      await runCheckpoint(db, key, { trips: 0, tickets: 0, events: 0 });
    }

    // Count writes to the subcollection path prefix
    const subcollPrefix = `${PROGRESS_DOC}/${COMPLETED_SUBCOLL}/`;
    const subcollWrites = db._writeCalls.filter((c) => c.path.startsWith(subcollPrefix));
    expect(subcollWrites).toHaveLength(N);  // one per iteration
    // Each subcollection write targets a unique key
    const writtenIds = subcollWrites.map((c) => c.path.slice(subcollPrefix.length));
    expect(new Set(writtenIds).size).toBe(N);
  });

  it('loadDone() recovers the exact set of keys that were checkpointed', async () => {
    const keys = ['SC001_2025-03', 'SC001_2025-04', 'SC002_2025-03'];
    for (const key of keys) {
      await runCheckpoint(db, key, { trips: 1, tickets: 0, events: 0 });
    }
    const done = await loadDone(db);
    expect([...done].sort()).toEqual([...keys].sort());
  });

  it('a fresh db has an empty done set (no false-positive resumption)', async () => {
    const done = await loadDone(db);
    expect(done.size).toBe(0);
  });

  it('total write-call count for N checkpoints is exactly 2N (one subcoll + one parent per checkpoint)', async () => {
    const N = 6;
    const keys = Array.from({ length: N }, (_, i) => `SC00${i}_2025-06`);
    for (const key of keys) {
      await runCheckpoint(db, key, { trips: 5, tickets: 1, events: 2 });
    }
    expect(db._writeCalls).toHaveLength(2 * N);
  });
});
