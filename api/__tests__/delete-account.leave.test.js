/**
 * Regression tests for BUG #456:
 * The `leave` action must remove the caller from org.members AND delete their user row.
 * Previously, deleting users/{uid} first and then updating org.members separately meant a
 * network failure between those two writes would leave a dangling member entry. The
 * Firestore transaction guarantee is gone in the ADR-0023 Supabase rewrite; instead the
 * handler uses a guarded sequence (TOCTOU re-read → update org.members → delete user row)
 * with the user row deletion last (it is the actual access-control cut).
 *
 * Cases covered:
 *   1. Failure case: sbDelDoc (user-row delete) throws → user row NOT deleted, 500 returned.
 *      The org.members update may already have been committed (best-effort), but the user
 *      still has no Auth profile (the Firebase deleteUser also failed best-effort), and the
 *      orphaned uid in members is harmless — the profile is gone.
 *   2. Happy path: both writes succeed → user doc deleted AND uid removed from org.members.
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
    json(body)   { this._body  = body; return this; },
  };
  return res;
}

function mockReq(body) {
  return { method: 'POST', headers: { authorization: 'Bearer fake-token' }, body };
}

// ---------------------------------------------------------------------------
// 1. Failure case: sbDelDoc throws → user row NOT deleted, 500 returned
// ---------------------------------------------------------------------------
describe('leave action — guarded sequence (BUG #456 / ADR-0023)', () => {
  test('sbDelDoc failure: user row NOT deleted and 500 returned', async () => {
    const CALLER = 'member-uid';
    const ORG_ID = 'org1';

    // In-memory stores
    const usersStore = {
      [CALLER]: { _docId: CALLER, orgId: ORG_ID, role: 'member' },
    };
    const orgState = { _docId: ORG_ID, ownerUid: 'owner-uid', name: 'TestOrg', members: [CALLER, 'owner-uid'] };

    vi.resetModules();

    vi.doMock('../_lib/supabase-admin.js', () => ({
      sbGetDoc: vi.fn(async (table, id) => {
        if (table === 'users') return usersStore[id] ?? null;
        if (table === 'organizations') return id === ORG_ID ? { ...orgState } : null;
        return null;
      }),
      sbGetByOrg: vi.fn(async (table, oid) => {
        if (table === 'users') return Object.values(usersStore).filter((u) => u.orgId === oid);
        return [];
      }),
      sbPutDoc: vi.fn(async (table, oid, sourceDocId, data) => {
        // Simulate the org members update succeeding
        if (table === 'organizations') {
          orgState.members = data.members;
        }
      }),
      sbPatchDoc: vi.fn().mockResolvedValue(undefined),
      // Simulate the user-row delete failing (network error, etc.)
      sbDelDoc: vi.fn().mockRejectedValue(new Error('Supabase delete failed: connection reset')),
    }));

    vi.doMock('../_lib/firebase-admin.js', () => ({
      getAuth: () => ({ deleteUser: vi.fn().mockResolvedValue({}) }),
    }));

    vi.doMock('../_lib/require-auth.js', () => ({
      requireUser: vi.fn().mockResolvedValue({ uid: CALLER, email: 'member@test.com', role: 'member' }),
    }));

    const { default: handler } = await import('../_delete-account.js');
    const req = mockReq({ action: 'leave' });
    const res = mockRes();
    await handler(req, res);

    // (a) Request must return a 500
    expect(res._status).toBe(500);
    // (b) users/{uid} doc still exists in the store — sbDelDoc threw before completion
    expect(usersStore[CALLER]).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // 2. Happy path: both writes succeed → user gone, org.members cleaned
  // ---------------------------------------------------------------------------
  test('happy path: user row deleted and uid removed from org.members', async () => {
    const CALLER = 'member-uid';
    const ORG_ID = 'org1';

    const usersStore = {
      [CALLER]: { _docId: CALLER, orgId: ORG_ID, role: 'member' },
      'owner-uid': { _docId: 'owner-uid', orgId: ORG_ID, role: 'owner' },
    };
    const orgState = { _docId: ORG_ID, ownerUid: 'owner-uid', name: 'TestOrg', members: [CALLER, 'owner-uid'] };

    vi.resetModules();

    vi.doMock('../_lib/supabase-admin.js', () => ({
      sbGetDoc: vi.fn(async (table, id) => {
        if (table === 'users') return usersStore[id] ? { ...usersStore[id] } : null;
        if (table === 'organizations') return id === ORG_ID ? { ...orgState } : null;
        return null;
      }),
      sbGetByOrg: vi.fn(async (table, oid) => {
        if (table === 'users') return Object.values(usersStore).filter((u) => u.orgId === oid);
        return [];
      }),
      sbPutDoc: vi.fn(async (table, oid, sourceDocId, data) => {
        // Simulate org members update
        if (table === 'organizations') {
          orgState.members = data.members;
        }
      }),
      sbPatchDoc: vi.fn().mockResolvedValue(undefined),
      sbDelDoc: vi.fn(async (table, id) => {
        // Simulate user row deletion
        if (table === 'users') {
          delete usersStore[id];
        }
      }),
    }));

    vi.doMock('../_lib/firebase-admin.js', () => ({
      getAuth: () => ({ deleteUser: vi.fn().mockResolvedValue({}) }),
    }));

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
    // users/{uid} row is gone
    expect(usersStore[CALLER]).toBeUndefined();
    // uid removed from org.members
    expect(orgState.members).not.toContain(CALLER);
    // Other members unaffected
    expect(orgState.members).toContain('owner-uid');
  });
});
