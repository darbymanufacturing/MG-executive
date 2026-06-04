/**
 * Regression tests for BUG #409:
 * delete-account.js delete-org action must use org.ownerUid as the sole
 * ownership gate — NOT the denormalized users/{uid}.role field, which can be stale.
 *
 * Key invariant: a user whose role is 'owner' but whose org.ownerUid points to a
 * different UID must be denied (403), not granted access to delete/transfer the org.
 *
 * ADR-0023 Stage-1: mocks api/_lib/supabase-admin.js (sbGetDoc/sbGetByOrg/sbPatchDoc)
 * instead of firebase-admin getDb. getAuth is still mocked from firebase-admin.
 */
import { describe, test, expect, vi } from 'vitest';

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
// Module factory — returns the handler with injected mocks
// ---------------------------------------------------------------------------
async function loadHandler({ callerUid, callerRole, orgOwnerUid, orgId = 'org1', orgName = 'TestOrg' }) {
  // In-memory stores
  const usersStore = {
    [callerUid]: { _docId: callerUid, orgId, role: callerRole },
    'successor-uid': { _docId: 'successor-uid', orgId, role: 'admin' },
  };
  const orgsStore = {
    [orgId]: { _docId: orgId, ownerUid: orgOwnerUid, name: orgName, members: [callerUid] },
  };

  vi.resetModules();

  vi.doMock('../_lib/supabase-admin.js', () => ({
    sbGetDoc: vi.fn(async (table, id) => {
      if (table === 'users') return usersStore[id] ?? null;
      if (table === 'organizations') return orgsStore[id] ?? null;
      return null;
    }),
    sbGetByOrg: vi.fn(async (table, oid) => {
      if (table === 'users') {
        return Object.values(usersStore).filter((u) => u.orgId === oid);
      }
      return [];
    }),
    sbPatchDoc: vi.fn().mockResolvedValue(undefined),
    sbPutDoc: vi.fn().mockResolvedValue(undefined),
    sbDelDoc: vi.fn().mockResolvedValue(undefined),
  }));

  vi.doMock('../_lib/firebase-admin.js', () => ({
    getAuth: () => ({ deleteUser: vi.fn().mockResolvedValue({}) }),
  }));

  vi.doMock('../_lib/require-auth.js', () => ({
    requireUser: vi.fn().mockResolvedValue({ uid: callerUid, email: 'test@test.com', role: callerRole }),
  }));

  const mod = await import('../_delete-account.js');
  return { handler: mod.default };
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
