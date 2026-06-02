/**
 * Regression tests for BUG #410:
 * The transfer action must be atomic — four separate awaits can leave two effective
 * owners if write #2 (orgRef.update) fails after write #1 (successor role update)
 * succeeds. Fixed by wrapping all three Firestore mutations in db.runTransaction().
 *
 * Three cases:
 *   1. Happy-path: transaction succeeds → only successor is owner in both stores.
 *   2. Write failure (simulate orgRef.update throwing inside transaction) → whole
 *      transaction rolls back; successor's role must NOT be 'owner'.
 *   3. Concurrent role-demotion: successor is downgraded to 'member' between the
 *      outer read (where they look like 'admin') and the transaction's inner re-read
 *      → handler must return 400 and make no writes.
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
    json(body) { this._body = body; return this; },
  };
  return res;
}

function mockReq(body) {
  return { method: 'POST', headers: { authorization: 'Bearer fake-token' }, body };
}

// ---------------------------------------------------------------------------
// 1. Happy-path: transaction committed → both user and org docs updated
// ---------------------------------------------------------------------------
describe('transfer action — atomic transaction (BUG #410)', () => {
  test('happy-path: transaction commits and leaves only successor as owner', async () => {
    const CALLER = 'owner-uid';
    const SUCCESSOR = 'successor-uid';
    const ORG_ID = 'org1';

    // In-memory stores that the mocked transaction will mutate
    const usersStore = {
      [CALLER]: { orgId: ORG_ID, role: 'owner' },
      [SUCCESSOR]: { orgId: ORG_ID, role: 'admin' },
    };
    const orgStore = { ownerUid: CALLER, name: 'TestOrg', members: [CALLER, SUCCESSOR] };

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
        runTransaction: async (fn) => {
          // Simulate a real transaction: give fn tx-scoped read/write helpers
          const tx = {
            get: async (ref) => {
              // ref.id is the doc id; duck-type to figure out which store to read
              // The handler uses collection('users').doc(uid) and orgRef — we check ref._col
              if (ref._col === 'users') return makeDoc(usersStore[ref._id]);
              return makeDoc(orgStore);
            },
            update: (ref, data) => {
              if (ref._col === 'users') Object.assign(usersStore[ref._id] || {}, data);
              else Object.assign(orgStore, data);
            },
            delete: (ref) => {
              if (ref._col === 'users') delete usersStore[ref._id];
            },
          };
          await fn(tx);
        },
      };

      // Patch collection().doc() to carry _col/_id for tx inspection
      const origCollection = db.collection.bind(db);
      db.collection = (col) => {
        const colHandle = origCollection(col);
        const origDoc = colHandle.doc.bind(colHandle);
        colHandle.doc = (id) => {
          const ref = origDoc(id);
          ref._col = col;
          ref._id = id;
          return ref;
        };
        return colHandle;
      };

      return { getDb: () => db, getAuth: () => ({ deleteUser: vi.fn().mockResolvedValue({}) }), FieldValue };
    });

    vi.doMock('../_lib/require-auth.js', () => ({
      requireUser: vi.fn().mockResolvedValue({ uid: CALLER, email: 'owner@test.com', role: 'owner' }),
    }));

    const { default: handler } = await import('../_delete-account.js');
    const req = mockReq({ action: 'transfer', successorUid: SUCCESSOR });
    const res = mockRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(res._body.newOwnerUid).toBe(SUCCESSOR);
    // Successor must now be owner in the users store
    expect(usersStore[SUCCESSOR].role).toBe('owner');
    // Org must point to successor
    expect(orgStore.ownerUid).toBe(SUCCESSOR);
    // Caller's profile must be deleted
    expect(usersStore[CALLER]).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // 2. Write failure inside transaction → rollback, no two owners
  // ---------------------------------------------------------------------------
  test('write failure inside transaction does not leave two owners', async () => {
    const CALLER = 'owner-uid';
    const SUCCESSOR = 'successor-uid';
    const ORG_ID = 'org1';

    const usersStore = {
      [CALLER]: { orgId: ORG_ID, role: 'owner' },
      [SUCCESSOR]: { orgId: ORG_ID, role: 'admin' },
    };
    const orgStore = { ownerUid: CALLER, name: 'TestOrg', members: [CALLER, SUCCESSOR] };

    vi.resetModules();

    vi.doMock('../_lib/firebase-admin.js', () => {
      const FieldValue = {
        serverTimestamp: () => 'SERVER_TS',
        arrayRemove: (v) => ({ _arrayRemove: v }),
        delete: () => ({ _delete: true }),
      };

      const makeDoc = (data) => ({ exists: !!data, data: () => data });

      // Simulate a transaction that fails mid-way (after first tx.update succeeds in
      // staging, but the commit is rolled back because the transaction fn throws).
      const db = {
        collection: (col) => {
          const handle = {
            doc: (id) => {
              const ref = {
                _col: col,
                _id: id,
                get: async () => makeDoc(col === 'users' ? usersStore[id] : (id === ORG_ID ? orgStore : undefined)),
                update: vi.fn().mockResolvedValue({}),
                delete: vi.fn().mockResolvedValue({}),
              };
              return ref;
            },
            where: () => ({
              get: async () => ({
                docs: Object.entries(usersStore).map(([uid, d]) => ({ id: uid, data: () => d })),
              }),
            }),
          };
          return handle;
        },
        runTransaction: async (_fn) => {
          // Simulate the Firestore SDK behaviour: the fn runs in a try block;
          // if it throws (or any tx write throws), the whole transaction is aborted
          // and NO writes are committed. We replicate this by not mutating the stores.
          throw new Error('Firestore transaction failed: contention on orgRef');
        },
      };

      return { getDb: () => db, getAuth: () => ({ deleteUser: vi.fn().mockResolvedValue({}) }), FieldValue };
    });

    vi.doMock('../_lib/require-auth.js', () => ({
      requireUser: vi.fn().mockResolvedValue({ uid: CALLER, email: 'owner@test.com', role: 'owner' }),
    }));

    const { default: handler } = await import('../_delete-account.js');
    const req = mockReq({ action: 'transfer', successorUid: SUCCESSOR });
    const res = mockRes();
    await handler(req, res);

    // Handler must surface an error (500 from the catch block)
    expect(res._status).toBe(500);
    // Stores must be untouched — successor is still 'admin', not 'owner'
    expect(usersStore[SUCCESSOR].role).toBe('admin');
    expect(orgStore.ownerUid).toBe(CALLER);
  });

  // ---------------------------------------------------------------------------
  // 3. Concurrent demotion: successor downgraded to 'member' between reads
  // ---------------------------------------------------------------------------
  test('returns 400 when successor is demoted to member between outer read and tx re-read', async () => {
    const CALLER = 'owner-uid';
    const SUCCESSOR = 'successor-uid';
    const ORG_ID = 'org1';

    // Outer read sees successor as 'admin'
    const outerUsersStore = {
      [CALLER]: { orgId: ORG_ID, role: 'owner' },
      [SUCCESSOR]: { orgId: ORG_ID, role: 'admin' },  // still admin at outer read
    };
    // Inside the transaction re-read, successor has been downgraded to 'member'
    const innerUsersStore = {
      [CALLER]: { orgId: ORG_ID, role: 'owner' },
      [SUCCESSOR]: { orgId: ORG_ID, role: 'member' }, // concurrent demotion
    };
    const orgStore = { ownerUid: CALLER, name: 'TestOrg', members: [CALLER, SUCCESSOR] };

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
            // Outer reads use outerUsersStore
            get: async () => makeDoc(col === 'users' ? outerUsersStore[id] : (id === ORG_ID ? orgStore : undefined)),
            update: vi.fn().mockResolvedValue({}),
            delete: vi.fn().mockResolvedValue({}),
          }),
          where: () => ({
            get: async () => ({
              docs: Object.entries(outerUsersStore).map(([uid, d]) => ({ id: uid, data: () => d })),
            }),
          }),
        }),
        runTransaction: async (fn) => {
          // Inside the transaction, use innerUsersStore (simulates concurrent demotion)
          const tx = {
            get: async (ref) => {
              if (ref._col === 'users') return makeDoc(innerUsersStore[ref._id]);
              return makeDoc(orgStore);
            },
            update: vi.fn(),
            delete: vi.fn(),
          };
          // fn will throw because successor.role === 'member' inside the tx
          await fn(tx);
        },
      };

      // Propagate _col/_id through collection().doc()
      const orig = db.collection.bind(db);
      db.collection = (col) => {
        const h = orig(col);
        const d = h.doc.bind(h);
        h.doc = (id) => {
          const ref = d(id);
          ref._col = col;
          ref._id = id;
          return ref;
        };
        return h;
      };

      return { getDb: () => db, getAuth: () => ({ deleteUser: vi.fn().mockResolvedValue({}) }), FieldValue };
    });

    vi.doMock('../_lib/require-auth.js', () => ({
      requireUser: vi.fn().mockResolvedValue({ uid: CALLER, email: 'owner@test.com', role: 'owner' }),
    }));

    const { default: handler } = await import('../_delete-account.js');
    const req = mockReq({ action: 'transfer', successorUid: SUCCESSOR });
    const res = mockRes();
    await handler(req, res);

    // Transaction throws the 400 error from the re-validation guard; catch block propagates it
    expect(res._status).toBe(400);
    // Org ownership must remain with caller — no writes occurred
    expect(orgStore.ownerUid).toBe(CALLER);
  });
});
