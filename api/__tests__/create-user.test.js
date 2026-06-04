/**
 * api/__tests__/create-user.test.js
 *
 * Unit tests for api/_create-user.js (ADR-0023 Stage-1).
 * Mocks supabase-admin.js (sbGetDoc/sbPutDoc) and firebase-admin.js (getAuth).
 * requireUser is mocked to return a configurable caller uid.
 * Does NOT touch Firestore or real Supabase.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mutable mock state — reset per test
// ---------------------------------------------------------------------------
let callerProfile = { _docId: 'caller-uid', role: 'owner', orgId: 'org-abc' };
let sbPutDocMock;
let sbDelDocMock;
let createUserMock;
let setCustomUserClaimsMock;
let getUserMock;
let requireUserMock;

function resetMocks() {
  callerProfile = { _docId: 'caller-uid', role: 'owner', orgId: 'org-abc' };
  sbPutDocMock = vi.fn().mockResolvedValue(undefined);
  sbDelDocMock = vi.fn().mockResolvedValue(undefined);
  createUserMock = vi.fn().mockResolvedValue({ uid: 'new-uid-999' });
  setCustomUserClaimsMock = vi.fn().mockResolvedValue(undefined);
  getUserMock = vi.fn().mockResolvedValue({ customClaims: {} });
  requireUserMock = vi.fn().mockImplementation(async (_req, _res) => ({
    uid: 'caller-uid',
    email: 'caller@test.com',
    role: null,
  }));
}

resetMocks();

vi.mock('../_lib/supabase-admin.js', () => ({
  sbGetDoc: vi.fn(async (_table, id) => {
    if (id === 'caller-uid') return callerProfile;
    return null;
  }),
  sbPutDoc: (...args) => sbPutDocMock(...args),
  sbDelDoc: (...args) => sbDelDocMock(...args),
}));

vi.mock('../_lib/firebase-admin.js', () => ({
  getAuth: () => ({
    createUser: (...args) => createUserMock(...args),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    setCustomUserClaims: (...args) => setCustomUserClaimsMock(...args),
    getUser: (...args) => getUserMock(...args),
  }),
}));

vi.mock('../_lib/require-auth.js', () => ({
  requireUser: (...args) => requireUserMock(...args),
}));

import handler from '../_create-user.js';
import { sbGetDoc } from '../_lib/supabase-admin.js';
import { getAuth } from '../_lib/firebase-admin.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeReq(body = {}) {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer valid-token' },
    body,
  };
}

function makeRes() {
  const res = {
    _status: null,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
  };
  return res;
}

beforeEach(() => {
  resetMocks();
  vi.clearAllMocks();
  // Re-apply mocks to the module references after clearAllMocks.
  sbPutDocMock = vi.fn().mockResolvedValue(undefined);
  sbDelDocMock = vi.fn().mockResolvedValue(undefined);
  createUserMock = vi.fn().mockResolvedValue({ uid: 'new-uid-999' });
  setCustomUserClaimsMock = vi.fn().mockResolvedValue(undefined);
  getUserMock = vi.fn().mockResolvedValue({ customClaims: {} });
  requireUserMock = vi.fn().mockImplementation(async (_req, _res) => ({
    uid: 'caller-uid',
    email: 'caller@test.com',
    role: null,
  }));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('_create-user — method guard', () => {
  it('rejects GET with 405', async () => {
    const req = { method: 'GET', headers: {}, body: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(405);
  });
});

describe('_create-user — requireUser gate', () => {
  it('returns early (no status) when requireUser returns null', async () => {
    requireUserMock = vi.fn().mockImplementation(async (_req, res) => {
      res.status(401).json({ error: 'unauth' });
      return null;
    });
    const res = makeRes();
    await handler(makeReq({ email: 'a@b.com', password: 'pass123', role: 'crew' }), res);
    expect(res._status).toBe(401);
  });
});

describe('_create-user — caller role guards', () => {
  it('returns 403 when caller role is "staff"', async () => {
    callerProfile = { _docId: 'caller-uid', role: 'staff', orgId: 'org-abc' };
    const res = makeRes();
    await handler(makeReq({ email: 'a@b.com', password: 'pass123', role: 'crew' }), res);
    expect(res._status).toBe(403);
  });

  it('returns 403 when caller role is "crew"', async () => {
    callerProfile = { _docId: 'caller-uid', role: 'crew', orgId: 'org-abc' };
    const res = makeRes();
    await handler(makeReq({ email: 'a@b.com', password: 'pass123', role: 'crew' }), res);
    expect(res._status).toBe(403);
  });

  it('returns 403 when caller is "admin" trying to create another admin (#452)', async () => {
    callerProfile = { _docId: 'caller-uid', role: 'admin', orgId: 'org-abc' };
    const res = makeRes();
    await handler(makeReq({ email: 'a@b.com', password: 'pass123', role: 'admin' }), res);
    expect(res._status).toBe(403);
  });

  it('allows "owner" to create an admin', async () => {
    callerProfile = { _docId: 'caller-uid', role: 'owner', orgId: 'org-abc' };
    sbPutDocMock = vi.fn().mockResolvedValue(undefined);
    createUserMock = vi.fn().mockResolvedValue({ uid: 'new-uid-999' });
    setCustomUserClaimsMock = vi.fn().mockResolvedValue(undefined);
    const res = makeRes();
    await handler(makeReq({ email: 'a@b.com', password: 'pass123', role: 'admin' }), res);
    expect(res._status).toBe(200);
  });
});

describe('_create-user — validation', () => {
  it('returns 400 when email is missing', async () => {
    const res = makeRes();
    await handler(makeReq({ password: 'pass123', role: 'crew' }), res);
    expect(res._status).toBe(400);
  });

  it('returns 400 when password is missing', async () => {
    const res = makeRes();
    await handler(makeReq({ email: 'a@b.com', role: 'crew' }), res);
    expect(res._status).toBe(400);
  });
});

describe('_create-user — happy path', () => {
  it('creates auth user, writes profile, sets claims, returns { ok, uid }', async () => {
    sbPutDocMock = vi.fn().mockResolvedValue(undefined);
    createUserMock = vi.fn().mockResolvedValue({ uid: 'new-uid-999' });
    setCustomUserClaimsMock = vi.fn().mockResolvedValue(undefined);

    const res = makeRes();
    await handler(makeReq({ email: 'newbie@test.com', password: 'secret123', displayName: 'Newbie', role: 'staff' }), res);

    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(res._body.uid).toBe('new-uid-999');

    // createUser called with correct args
    expect(createUserMock).toHaveBeenCalledWith({
      email: 'newbie@test.com',
      password: 'secret123',
      displayName: 'Newbie',
    });

    // Supabase profile written with orgId from CALLER profile (not from request)
    expect(sbPutDocMock).toHaveBeenCalledWith(
      'users',
      'org-abc',        // callerOrgId
      'new-uid-999',    // new user's uid
      expect.objectContaining({
        role: 'staff',
        orgId: 'org-abc',
        displayName: 'Newbie',
        email: 'newbie@test.com',
      })
    );

    // Claims set correctly (ADR-0017)
    expect(setCustomUserClaimsMock).toHaveBeenCalledWith('new-uid-999', {
      orgId: 'org-abc',
      role: 'authenticated',
      user_role: 'staff',
    });
  });

  it('clamps unknown role to "crew"', async () => {
    sbPutDocMock = vi.fn().mockResolvedValue(undefined);
    createUserMock = vi.fn().mockResolvedValue({ uid: 'new-uid-999' });
    setCustomUserClaimsMock = vi.fn().mockResolvedValue(undefined);

    const res = makeRes();
    await handler(makeReq({ email: 'a@b.com', password: 'pass123', role: 'superadmin' }), res);

    expect(res._status).toBe(200);
    const [, , , userData] = sbPutDocMock.mock.calls[0];
    expect(userData.role).toBe('crew');
    expect(setCustomUserClaimsMock.mock.calls[0][1].user_role).toBe('crew');
  });

  it('derives displayName from email when not provided', async () => {
    sbPutDocMock = vi.fn().mockResolvedValue(undefined);
    createUserMock = vi.fn().mockResolvedValue({ uid: 'new-uid-999' });
    setCustomUserClaimsMock = vi.fn().mockResolvedValue(undefined);

    const res = makeRes();
    await handler(makeReq({ email: 'alex@scooters.gr', password: 'pass123', role: 'crew' }), res);

    const createArgs = createUserMock.mock.calls[0][0];
    expect(createArgs.displayName).toBe('alex');
  });

  it('merges pre-existing custom claims', async () => {
    getUserMock = vi.fn().mockResolvedValue({ customClaims: { beta: true } });
    sbPutDocMock = vi.fn().mockResolvedValue(undefined);
    createUserMock = vi.fn().mockResolvedValue({ uid: 'new-uid-999' });
    setCustomUserClaimsMock = vi.fn().mockResolvedValue(undefined);

    const res = makeRes();
    await handler(makeReq({ email: 'a@b.com', password: 'pass123', role: 'crew' }), res);

    const claimArgs = setCustomUserClaimsMock.mock.calls[0][1];
    expect(claimArgs.beta).toBe(true);
    expect(claimArgs.role).toBe('authenticated');
    expect(claimArgs.user_role).toBe('crew');
  });
});

describe('_create-user — rollback on profile/claim failure', () => {
  it('deletes the auth user when sbPutDoc fails, returns 500', async () => {
    sbPutDocMock = vi.fn().mockRejectedValue(new Error('supabase write failed'));
    createUserMock = vi.fn().mockResolvedValue({ uid: 'new-uid-999' });
    const deleteUserMock = vi.fn().mockResolvedValue(undefined);
    // Patch getAuth to use our deleteUserMock
    const auth = getAuth();
    auth.deleteUser = deleteUserMock;

    const res = makeRes();
    await handler(makeReq({ email: 'a@b.com', password: 'pass123', role: 'crew' }), res);

    expect(res._status).toBe(500);
    expect(deleteUserMock).toHaveBeenCalledWith('new-uid-999');
  });
});
