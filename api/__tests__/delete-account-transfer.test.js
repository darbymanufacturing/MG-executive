/**
 * Regression tests for BUG #410:
 * The transfer action must write role promotion → org update → user-row delete in a
 * guarded sequence. Previously, separate awaits could leave two effective owners if a
 * write failed mid-way. In the ADR-0023 Supabase rewrite, Firestore transactions are
 * replaced by a TOCTOU-guarded sequence (re-read org + successor before writes, then
 * write in order: promote successor → update org → delete caller row).
 *
 * Three cases:
 *   1. Happy-path: all writes succeed → only successor is owner in both stores.
 *   2. Write failure on sbPutDoc (org update) → 500 returned. Successor's role write may
 *      have committed, but org.ownerUid is not yet updated (checked from the captured call).
 *   3. TOCTOU re-read: successor is downgraded to 'member' between outer read and the
 *      handler's TOCTOU re-read → handler must return 400 and make no writes.
 *
 * ADR-0023 Stage-1: mocks api/_lib/supabase-admin.js instead of firebase-admin getDb.
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
// 1. Happy-path: all writes succeed → successor is owner, caller is gone
// ---------------------------------------------------------------------------
describe('transfer action — guarded sequence (BUG #410 / ADR-0023)', () => {
  test('happy-path: writes commit and leave only successor as owner', async () => {
    const CALLER = 'owner-uid';
    const SUCCESSOR = 'successor-uid';
    const ORG_ID = 'org1';

    const usersStore = {
      [CALLER]: { _docId: CALLER, orgId: ORG_ID, role: 'owner' },
      [SUCCESSOR]: { _docId: SUCCESSOR, orgId: ORG_ID, role: 'admin' },
    };
    const orgStore = { _docId: ORG_ID, ownerUid: CALLER, name: 'TestOrg', members: [CALLER, SUCCESSOR] };

    vi.resetModules();

    vi.doMock('../_lib/supabase-admin.js', () => ({
      sbGetDoc: vi.fn(async (table, id) => {
        if (table === 'users') return usersStore[id] ? { ...usersStore[id] } : null;
        if (table === 'organizations') return id === ORG_ID ? { ...orgStore } : null;
        return null;
      }),
      sbGetByOrg: vi.fn(async (table, oid) => {
        if (table === 'users') return Object.values(usersStore).filter((u) => u.orgId === oid);
        return [];
      }),
      sbPutDoc: vi.fn(async (table, oid, sourceDocId, data) => {
        if (table === 'users') {
          usersStore[sourceDocId] = { ...usersStore[sourceDocId], ...data, _docId: sourceDocId };
        } else if (table === 'organizations') {
          Object.assign(orgStore, data);
        }
      }),
      sbPatchDoc: vi.fn().mockResolvedValue(undefined),
      sbDelDoc: vi.fn(async (table, id) => {
        if (table === 'users') delete usersStore[id];
      }),
    }));

    vi.doMock('../_lib/firebase-admin.js', () => ({
      getAuth: () => ({ deleteUser: vi.fn().mockResolvedValue({}) }),
    }));

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
    // Successor must now be owner
    expect(usersStore[SUCCESSOR].role).toBe('owner');
    // Org must point to successor
    expect(orgStore.ownerUid).toBe(SUCCESSOR);
    // Caller's profile must be deleted
    expect(usersStore[CALLER]).toBeUndefined();
    // Caller removed from org.members
    expect(orgStore.members).not.toContain(CALLER);
  });

  // ---------------------------------------------------------------------------
  // 2. Write failure on org sbPutDoc → 500 returned, org.ownerUid not yet updated
  // ---------------------------------------------------------------------------
  test('write failure on org update returns 500', async () => {
    const CALLER = 'owner-uid';
    const SUCCESSOR = 'successor-uid';
    const ORG_ID = 'org1';

    const usersStore = {
      [CALLER]: { _docId: CALLER, orgId: ORG_ID, role: 'owner' },
      [SUCCESSOR]: { _docId: SUCCESSOR, orgId: ORG_ID, role: 'admin' },
    };
    const orgStore = { _docId: ORG_ID, ownerUid: CALLER, name: 'TestOrg', members: [CALLER, SUCCESSOR] };

    vi.resetModules();

    let putDocCallCount = 0;
    vi.doMock('../_lib/supabase-admin.js', () => ({
      sbGetDoc: vi.fn(async (table, id) => {
        if (table === 'users') return usersStore[id] ? { ...usersStore[id] } : null;
        if (table === 'organizations') return id === ORG_ID ? { ...orgStore } : null;
        return null;
      }),
      sbGetByOrg: vi.fn(async (table, oid) => {
        if (table === 'users') return Object.values(usersStore).filter((u) => u.orgId === oid);
        return [];
      }),
      sbPutDoc: vi.fn(async (table, oid, sourceDocId, data) => {
        putDocCallCount++;
        if (table === 'users') {
          // Successor role promotion succeeds
          usersStore[sourceDocId] = { ...usersStore[sourceDocId], ...data, _docId: sourceDocId };
        } else if (table === 'organizations') {
          // Org update fails
          throw new Error('Supabase write failed: connection timeout');
        }
      }),
      sbPatchDoc: vi.fn().mockResolvedValue(undefined),
      sbDelDoc: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock('../_lib/firebase-admin.js', () => ({
      getAuth: () => ({ deleteUser: vi.fn().mockResolvedValue({}) }),
    }));

    vi.doMock('../_lib/require-auth.js', () => ({
      requireUser: vi.fn().mockResolvedValue({ uid: CALLER, email: 'owner@test.com', role: 'owner' }),
    }));

    const { default: handler } = await import('../_delete-account.js');
    const req = mockReq({ action: 'transfer', successorUid: SUCCESSOR });
    const res = mockRes();
    await handler(req, res);

    // Handler must surface an error (500 from the catch block)
    expect(res._status).toBe(500);
    // org.ownerUid must NOT have been updated (org write failed)
    expect(orgStore.ownerUid).toBe(CALLER);
  });

  // ---------------------------------------------------------------------------
  // 3. TOCTOU re-read: successor downgraded to 'member' between outer read and
  //    the handler's internal re-read → 400 and no writes
  // ---------------------------------------------------------------------------
  test('returns 400 when successor is demoted to member before the TOCTOU re-read', async () => {
    const CALLER = 'owner-uid';
    const SUCCESSOR = 'successor-uid';
    const ORG_ID = 'org1';

    // Outer read (sbGetByOrg) sees successor as 'admin'
    const outerUsersStore = {
      [CALLER]: { _docId: CALLER, orgId: ORG_ID, role: 'owner' },
      [SUCCESSOR]: { _docId: SUCCESSOR, orgId: ORG_ID, role: 'admin' },
    };
    const orgStore = { _docId: ORG_ID, ownerUid: CALLER, name: 'TestOrg', members: [CALLER, SUCCESSOR] };

    // sbGetDoc (TOCTOU re-read) sees successor as 'member'
    const innerSuccessor = { _docId: SUCCESSOR, orgId: ORG_ID, role: 'member' };

    vi.resetModules();

    const sbPutDocMock = vi.fn().mockResolvedValue(undefined);
    const sbDelDocMock = vi.fn().mockResolvedValue(undefined);

    vi.doMock('../_lib/supabase-admin.js', () => ({
      sbGetDoc: vi.fn(async (table, id) => {
        // org re-read: still valid
        if (table === 'organizations') return id === ORG_ID ? { ...orgStore } : null;
        // successor re-read: returns demoted role
        if (table === 'users' && id === SUCCESSOR) return { ...innerSuccessor };
        // caller's own profile read (outer + me read)
        if (table === 'users' && id === CALLER) return { ...outerUsersStore[CALLER] };
        return null;
      }),
      sbGetByOrg: vi.fn(async (table, oid) => {
        // outer members read uses the pre-demotion store
        if (table === 'users') return Object.values(outerUsersStore).filter((u) => u.orgId === oid);
        return [];
      }),
      sbPutDoc: sbPutDocMock,
      sbPatchDoc: vi.fn().mockResolvedValue(undefined),
      sbDelDoc: sbDelDocMock,
    }));

    vi.doMock('../_lib/firebase-admin.js', () => ({
      getAuth: () => ({ deleteUser: vi.fn().mockResolvedValue({}) }),
    }));

    vi.doMock('../_lib/require-auth.js', () => ({
      requireUser: vi.fn().mockResolvedValue({ uid: CALLER, email: 'owner@test.com', role: 'owner' }),
    }));

    const { default: handler } = await import('../_delete-account.js');
    const req = mockReq({ action: 'transfer', successorUid: SUCCESSOR });
    const res = mockRes();
    await handler(req, res);

    // Handler must return 400 (TOCTOU guard caught the demotion)
    expect(res._status).toBe(400);
    // No writes should have been made
    expect(sbPutDocMock).not.toHaveBeenCalled();
    expect(sbDelDocMock).not.toHaveBeenCalled();
    // org ownership must remain with caller
    expect(orgStore.ownerUid).toBe(CALLER);
  });
});
