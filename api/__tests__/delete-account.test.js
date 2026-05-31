/**
 * Regression tests for BUG #409:
 * delete-account.js delete-org action must use org.ownerUid as the sole
 * ownership gate — NOT the denormalized users/{uid}.role field, which can be stale.
 *
 * Key invariant: a user whose role is 'owner' but whose org.ownerUid points to a
 * different UID must be denied (403), not granted access to delete/transfer the org.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers to build mock req/res objects
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
// Firestore / Auth mocks — build per-test so we control the data
// ---------------------------------------------------------------------------
function buildFirebaseMock({ callerUid, callerRole, orgOwnerUid, orgId = 'org1', orgName = 'TestOrg' }) {
  const usersStore = {
    [callerUid]: { orgId, role: callerRole },
    // minimal successor admin (needed by some branches)
    'successor-uid': { orgId, role: 'admin' },
  };
  const orgsStore = {
    [orgId]: { ownerUid: orgOwnerUid, name: orgName, members: [callerUid] },
  };

  const makeDoc = (data) => ({
    exists: data !== undefined,
    data: () => data,
    id: 'stub',
  });

  const makeCollectionQuery = (store, orgIdFilter) => {
    const docs = Object.entries(store)
      .filter(([, d]) => d.orgId === orgIdFilter)
      .map(([uid, d]) => ({ id: uid, data: () => d }));
    return { docs };
  };

  const db = {
    collection: (col) => ({
      doc: (id) => ({
        get: async () => makeDoc(col === 'users' ? usersStore[id] : orgsStore[id]),
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
      }),
      where: () => ({
        get: async () => makeCollectionQuery(usersStore, orgId),
      }),
    }),
    runTransaction: vi.fn(),
  };

  return db;
}

// ---------------------------------------------------------------------------
// Module factory — returns the handler with injected mocks
// ---------------------------------------------------------------------------
async function loadHandler({ callerUid, callerRole, orgOwnerUid, orgId = 'org1', orgName = 'TestOrg' }) {
  const db = buildFirebaseMock({ callerUid, callerRole, orgOwnerUid, orgId, orgName });

  // Reset module registry so we can re-mock per test
  vi.resetModules();

  vi.doMock('../_lib/firebase-admin.js', () => ({
    getDb: () => db,
    getAuth: () => ({ deleteUser: vi.fn().mockResolvedValue({}) }),
    FieldValue: {
      serverTimestamp: () => 'SERVER_TS',
      arrayRemove: (v) => ({ _arrayRemove: v }),
      delete: () => ({ _delete: true }),
    },
  }));

  vi.doMock('../_lib/require-auth.js', () => ({
    requireUser: vi.fn().mockResolvedValue({ uid: callerUid, email: 'test@test.com', role: callerRole }),
  }));

  const mod = await import('../delete-account.js');
  return { handler: mod.default, db };
}

// ---------------------------------------------------------------------------
// BUG #409 regression: stale role='owner' + different ownerUid → must be 403
// ---------------------------------------------------------------------------
describe('delete-org ownership gate (BUG #409)', () => {
  test('403 when caller.role=owner but org.ownerUid is a different UID', async () => {
    const { handler } = await loadHandler({
      callerUid: 'stale-former-owner',
      callerRole: 'owner',       // stale denormalized role — still says owner
      orgOwnerUid: 'real-owner', // org.ownerUid points elsewhere
    });

    const req = mockReq({ action: 'delete-org', confirm: 'TestOrg' });
    const res = mockRes();
    await handler(req, res);

    expect(res._status).toBe(403);
    expect(res._body.error).toMatch(/Only the owner/i);
  });

  test('200 when caller uid matches org.ownerUid (role value is irrelevant)', async () => {
    const { handler } = await loadHandler({
      callerUid: 'real-owner',
      callerRole: 'member',     // even a "wrong" role must not block the true owner
      orgOwnerUid: 'real-owner',
    });

    const req = mockReq({ action: 'delete-org', confirm: 'TestOrg' });
    const res = mockRes();
    await handler(req, res);

    // 200 OR 400 (bad confirm) — must NOT be 403
    expect(res._status).not.toBe(403);
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
  });
});
