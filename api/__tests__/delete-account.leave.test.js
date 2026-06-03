/**
 * Regression tests for BUG #456:
 * The `leave` action must atomically remove the user profile doc AND remove the
 * UID from org.members in a single Firestore transaction. Previously, deleting
 * users/{uid} first and then updating org.members separately meant a network
 * failure between those two writes would leave a dangling member entry (a UID
 * still in org.members with no corresponding users/ doc). Fixed by wrapping
 * both Firestore mutations in db.runTransaction(), mirroring the transfer action.
 *
 * Cases covered:
 *   1. Failure case: transaction throws → user profile NOT deleted, org.members unchanged (no dangling entry).
 *   2. Happy path: transaction commits → user profile deleted AND uid removed from org.members.
 */
import { describe, test, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mockRes() {
  const res = {
    _status: null,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body)   { this._body  = body; return this; },
  };
  return res;
}

function mockReq(body) {
  return { method: 'POST', headers: { authorization: 'Bearer fake-token' }, body };
}

// ---------------------------------------------------------------------------
// 1. Failure case: transaction rolls back — no dangling member entry
// ---------------------------------------------------------------------------
describe('leave action — atomic transaction (BUG #456)', () => {
  test('transaction failure: user doc NOT deleted and org.members unchanged', async () => {
    const CALLER = 'member-uid';
    const ORG_ID = 'org1';

    const usersStore = {
      [CALLER]: { orgId: ORG_ID, role: 'member' },
    };
    const orgStore = { ownerUid: 'owner-uid', name: 'TestOrg', members: [CALLER, 'owner-uid'] };

    vi.resetModules();

    vi.doMock('../_lib/firebase-admin.js', () => {
      const FieldValue = {
        serverTimestamp: () => 'SERVER_TS',
        arrayRemove: (v) => ({ _arrayRemove: v }),
        delete: () => ({ _delete: true }),
      };

      const makeDoc = (data) => ({ exists: !!data, data: () => data });

      const db = {
        collection: (col) => ({
          doc: (id) => ({
            _col: col,
            _id: id,
            get: async () => makeDoc(col === 'users' ? usersStore[id] : (id === ORG_ID ? orgStore : undefined)),
            update: vi.fn().mockResolvedValue({}),
            delete: vi.fn().mockResolvedValue({}),
          }),
          where: () => ({
            get: async () => ({
              docs: Object.entries(usersStore).map(([uid, d]) => ({ id: uid, data: () => d })),
            }),
          }),
        }),
        // Simulate a Firestore transaction that fails (network / contention).
        // The Firestore SDK guarantees no writes are committed when the transaction aborts.
        runTransaction: async (_fn) => {
          throw new Error('Firestore transaction failed: contention');
        },
      };

      // Propagate _col/_id so transaction tx.get() can find the right store
      const origCollection = db.collection.bind(db);
      db.collection = (col) => {
        const h = origCollection(col);
        const origDoc = h.doc.bind(h);
        h.doc = (id) => {
          const ref = origDoc(id);
          ref._col = col;
          ref._id  = id;
          return ref;
        };
        return h;
      };

      return { getDb: () => db, getAuth: () => ({ deleteUser: vi.fn().mockResolvedValue({}) }), FieldValue };
    });

    vi.doMock('../_lib/require-auth.js', () => ({
      requireUser: vi.fn().mockResolvedValue({ uid: CALLER, email: 'member@test.com', role: 'member' }),
    }));

    const { default: handler } = await import('../_delete-account.js');
    const req = mockReq({ action: 'leave' });
    const res = mockRes();
    await handler(req, res);

    // (a) Request must return a 500 (transaction aborted → catch block)
    expect(res._status).toBe(500);
    // (b) users/{uid} doc still exists — was NOT deleted (transaction rolled back)
    expect(usersStore[CALLER]).toBeDefined();
    // (c) org.members still contains the uid — no dangling entry created
    expect(orgStore.members).toContain(CALLER);
  });

  // ---------------------------------------------------------------------------
  // 2. Happy path: transaction commits → user gone, org.members cleaned
  // ---------------------------------------------------------------------------
  test('happy path: transaction commits — user doc deleted and uid removed from org.members', async () => {
    const CALLER = 'member-uid';
    const ORG_ID = 'org1';

    const usersStore = {
      [CALLER]: { orgId: ORG_ID, role: 'member' },
      'owner-uid': { orgId: ORG_ID, role: 'owner' },
    };
    // Track in-memory state so we can assert post-transaction
    const orgState = { ownerUid: 'owner-uid', name: 'TestOrg', members: [CALLER, 'owner-uid'] };

    vi.resetModules();

    vi.doMock('../_lib/firebase-admin.js', () => {
      const FieldValue = {
        serverTimestamp: () => 'SERVER_TS',
        arrayRemove: (v) => ({ _arrayRemove: v }),
        delete: () => ({ _delete: true }),
      };

      const makeDoc = (data) => ({ exists: !!data, data: () => data });

      const db = {
        collection: (col) => ({
          doc: (id) => ({
            _col: col,
            _id: id,
            get: async () => makeDoc(col === 'users' ? usersStore[id] : (id === ORG_ID ? orgState : undefined)),
            update: vi.fn().mockResolvedValue({}),
            delete: vi.fn().mockResolvedValue({}),
          }),
          where: () => ({
            get: async () => ({
              docs: Object.entries(usersStore).map(([uid, d]) => ({ id: uid, data: () => d })),
            }),
          }),
        }),
        runTransaction: async (fn) => {
          // Simulate a successful commit: execute fn with a tx that mutates the stores.
          const tx = {
            get: async (ref) => {
              if (ref._col === 'users') return makeDoc(usersStore[ref._id]);
              return makeDoc(orgState);
            },
            update: (ref, data) => {
              // Simulate arrayRemove for org.members
              if (ref._col !== 'users' && data.members && data.members._arrayRemove) {
                orgState.members = orgState.members.filter((m) => m !== data.members._arrayRemove);
              }
            },
            delete: (ref) => {
              if (ref._col === 'users') {
                delete usersStore[ref._id];
              }
            },
          };
          await fn(tx);
        },
      };

      // Propagate _col/_id through collection().doc()
      const origCollection = db.collection.bind(db);
      db.collection = (col) => {
        const h = origCollection(col);
        const origDoc = h.doc.bind(h);
        h.doc = (id) => {
          const ref = origDoc(id);
          ref._col = col;
          ref._id  = id;
          return ref;
        };
        return h;
      };

      return { getDb: () => db, getAuth: () => ({ deleteUser: vi.fn().mockResolvedValue({}) }), FieldValue };
    });

    vi.doMock('../_lib/require-auth.js', () => ({
      requireUser: vi.fn().mockResolvedValue({ uid: CALLER, email: 'member@test.com', role: 'member' }),
    }));

    const { default: handler } = await import('../_delete-account.js');
    const req = mockReq({ action: 'leave' });
    const res = mockRes();
    await handler(req, res);

    // Request succeeds
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(res._body.action).toBe('leave');
    // users/{uid} doc is gone
    expect(usersStore[CALLER]).toBeUndefined();
    // uid removed from org.members
    expect(orgState.members).not.toContain(CALLER);
    // Other members unaffected
    expect(orgState.members).toContain('owner-uid');
  });
});
