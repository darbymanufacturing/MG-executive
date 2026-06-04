/**
 * api/__tests__/signup.test.js
 *
 * Unit tests for api/_signup.js (ADR-0023 Stage-1).
 * Mocks supabase-admin.js (sbPutDoc/sbDelDoc) and firebase-admin.js (verifyIdToken/getAuth).
 * Does NOT touch Firestore or real Supabase.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mock state (mutated per-test in beforeEach)
// ---------------------------------------------------------------------------
let sbPutDocMock;
let sbDelDocMock;
let setCustomUserClaimsMock;
let getUserMock;
let verifyIdTokenMock;

function resetMocks() {
  sbPutDocMock = vi.fn().mockResolvedValue(undefined);
  sbDelDocMock = vi.fn().mockResolvedValue(undefined);
  setCustomUserClaimsMock = vi.fn().mockResolvedValue(undefined);
  getUserMock = vi.fn().mockResolvedValue({ customClaims: {} });
  verifyIdTokenMock = vi.fn().mockResolvedValue({ uid: 'uid-123', email: 'owner@test.com' });
}

resetMocks();

vi.mock('../_lib/supabase-admin.js', () => ({
  sbPutDoc: (...args) => sbPutDocMock(...args),
  sbDelDoc: (...args) => sbDelDocMock(...args),
}));

vi.mock('../_lib/firebase-admin.js', () => ({
  verifyIdToken: (...args) => verifyIdTokenMock(...args),
  getAuth: () => ({
    setCustomUserClaims: (...args) => setCustomUserClaimsMock(...args),
    getUser: (...args) => getUserMock(...args),
  }),
}));

import handler from '../_signup.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeReq(body = {}, bearer = 'Bearer valid-token') {
  return {
    method: 'POST',
    headers: { authorization: bearer },
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
  sbPutDocMock = vi.fn().mockResolvedValue(undefined);
  sbDelDocMock = vi.fn().mockResolvedValue(undefined);
  setCustomUserClaimsMock = vi.fn().mockResolvedValue(undefined);
  getUserMock = vi.fn().mockResolvedValue({ customClaims: {} });
  verifyIdTokenMock = vi.fn().mockResolvedValue({ uid: 'uid-123', email: 'owner@test.com' });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('_signup — method guard', () => {
  it('rejects GET with 405', async () => {
    const req = { method: 'GET', headers: {}, body: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(405);
  });
});

describe('_signup — auth guards', () => {
  it('returns 401 when no Authorization header', async () => {
    const req = makeReq({ orgName: 'Acme' }, '');
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(401);
  });

  it('returns 401 when token is invalid', async () => {
    verifyIdTokenMock = vi.fn().mockRejectedValue(new Error('bad token'));
    const req = makeReq({ orgName: 'Acme' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(401);
  });
});

describe('_signup — validation', () => {
  it('returns 400 when orgName is missing', async () => {
    const req = makeReq({ orgName: '' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
  });

  it('returns 400 when orgName is whitespace only', async () => {
    const req = makeReq({ orgName: '   ' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
  });
});

describe('_signup — happy path', () => {
  it('creates org + user rows and sets claims, returns { ok, orgId }', async () => {
    const req = makeReq({ orgName: 'My Fleet', displayName: 'Kostas' });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(typeof res._body.orgId).toBe('string');
    expect(res._body.orgId.length).toBeGreaterThan(0);

    // org row written
    expect(sbPutDocMock).toHaveBeenCalledTimes(2);
    const [orgTable, orgId, orgDocId, orgData] = sbPutDocMock.mock.calls[0];
    expect(orgTable).toBe('organizations');
    expect(orgId).toBe(orgDocId); // org uses its own id as source_doc_id
    expect(orgData.name).toBe('My Fleet');
    expect(orgData.ownerUid).toBe('uid-123');
    expect(orgData.members).toEqual(['uid-123']);
    expect(orgData.plan).toBe('trial');

    // user row written
    const [userTable, , userDocId, userData] = sbPutDocMock.mock.calls[1];
    expect(userTable).toBe('users');
    expect(userDocId).toBe('uid-123');
    expect(userData.role).toBe('owner');
    expect(userData.orgId).toBe(res._body.orgId);
    expect(userData.displayName).toBe('Kostas');
    expect(userData.email).toBe('owner@test.com');

    // claims set
    expect(setCustomUserClaimsMock).toHaveBeenCalledWith('uid-123', {
      orgId: res._body.orgId,
      role: 'authenticated',
      user_role: 'owner',
    });
  });

  it('falls back to email local-part when displayName is empty', async () => {
    const req = makeReq({ orgName: 'My Fleet', displayName: '' });
    const res = makeRes();
    await handler(req, res);

    const [, , , userData] = sbPutDocMock.mock.calls[1];
    expect(userData.displayName).toBe('owner'); // from 'owner@test.com'
  });

  it('merges pre-existing custom claims', async () => {
    getUserMock = vi.fn().mockResolvedValue({ customClaims: { stripeId: 'cus_abc' } });
    const req = makeReq({ orgName: 'My Fleet', displayName: 'Kostas' });
    const res = makeRes();
    await handler(req, res);

    const claimArgs = setCustomUserClaimsMock.mock.calls[0][1];
    expect(claimArgs.stripeId).toBe('cus_abc');
    expect(claimArgs.role).toBe('authenticated');
    expect(claimArgs.user_role).toBe('owner');
  });
});

describe('_signup — rollback on failure', () => {
  it('rolls back org + user rows when setCustomUserClaims fails, returns 500', async () => {
    setCustomUserClaimsMock = vi.fn().mockRejectedValue(new Error('claims error'));
    const req = makeReq({ orgName: 'My Fleet', displayName: 'Kostas' });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);
    // Both written rows should be deleted.
    expect(sbDelDocMock).toHaveBeenCalledTimes(2);
    const delCalls = sbDelDocMock.mock.calls.map((c) => c[1]);
    expect(delCalls).toContain('uid-123'); // user row key
    // org row key is the generated orgId; just check it was deleted once
    const orgDelCall = sbDelDocMock.mock.calls.find((c) => c[1] !== 'uid-123');
    expect(orgDelCall).toBeTruthy();
  });

  it('rolls back only org row when user write fails before user row is written', async () => {
    let callCount = 0;
    sbPutDocMock = vi.fn().mockImplementation(async () => {
      callCount += 1;
      if (callCount === 2) throw new Error('user write failed');
    });
    const req = makeReq({ orgName: 'My Fleet', displayName: 'Kostas' });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);
    // Only the org row had been written before the failure (user row failed).
    // The rollback should attempt to delete the org row but NOT the user row
    // (since userWritten never became true). sbDelDoc is called once for org.
    expect(sbDelDocMock).toHaveBeenCalledTimes(1);
  });
});
