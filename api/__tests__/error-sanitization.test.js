/**
 * Regression tests for BUG #436:
 * All API endpoints must NOT leak raw err.message (Firestore index URLs,
 * internal hostnames, service-account details) in 500 HTTP responses.
 *
 * Each test injects a realistic Firestore FAILED_PRECONDITION error and asserts
 * the response body contains only the safe static string, not the internal details.
 */
import { describe, test, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Shared realistic Firestore error (leaks project ID + collection paths)
// ---------------------------------------------------------------------------
const FIRESTORE_INDEX_ERROR = new Error(
  '9 FAILED_PRECONDITION: The query requires an index. You can create it here: ' +
  'https://console.firebase.google.com/project/mg-executive/database/firestore/' +
  'indexes?create_composite=Cg1teS1jb2xsZWN0aW9u'
);

const SENSITIVE_SUBSTRINGS = [
  'firebase.google.com',
  'mg-executive',
  'FAILED_PRECONDITION',
  'console.firebase',
];

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

function assertSanitized(res, expectedSafeString) {
  expect(res._status).toBe(500);
  const bodyStr = JSON.stringify(res._body);
  for (const sub of SENSITIVE_SUBSTRINGS) {
    expect(bodyStr).not.toContain(sub);
  }
  expect(res._body.error).toBe(expectedSafeString);
}

// ---------------------------------------------------------------------------
// bank-connections.js
// ---------------------------------------------------------------------------
describe('error-sanitization: bank-connections.js (BUG #436)', () => {
  test('returns safe error string when fetch throws', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(FIRESTORE_INDEX_ERROR));
    vi.stubEnv('SALTEDGE_APP_ID', 'x');
    vi.stubEnv('SALTEDGE_SECRET', 'y');

    vi.doMock('../_lib/require-auth.js', () => ({
      requireUser: vi.fn().mockResolvedValue({ uid: 'u1', role: 'admin' }),
    }));

    const mod = await import('../_bank-connections.js');
    const req = { method: 'GET', headers: { authorization: 'Bearer t' }, query: { customer_id: 'cust123' } };
    const res = mockRes();
    await mod.default(req, res);

    assertSanitized(res, 'Failed to load bank connections');
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// bank-session.js
// ---------------------------------------------------------------------------
describe('error-sanitization: bank-session.js (BUG #436)', () => {
  test('returns safe error string when Salt Edge fetch throws', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(FIRESTORE_INDEX_ERROR));
    vi.stubEnv('SALTEDGE_APP_ID', 'x');
    vi.stubEnv('SALTEDGE_SECRET', 'y');
    vi.stubEnv('APP_ORIGIN', 'https://omni.mgexecutive.app');

    vi.doMock('../_lib/require-auth.js', () => ({
      requireUser: vi.fn().mockResolvedValue({ uid: 'u1', role: 'admin' }),
    }));

    const mod = await import('../_bank-session.js');
    const req = { method: 'POST', headers: { authorization: 'Bearer t' }, body: {} };
    const res = mockRes();
    await mod.default(req, res);

    assertSanitized(res, 'Bank session error');
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// bank-refresh.js
// ---------------------------------------------------------------------------
describe('error-sanitization: bank-refresh.js (BUG #436)', () => {
  test('returns safe error string when Firestore throws on config read', async () => {
    vi.resetModules();
    vi.stubEnv('SALTEDGE_APP_ID', 'x');
    vi.stubEnv('SALTEDGE_SECRET', 'y');

    vi.doMock('../_lib/require-auth.js', () => ({
      requireUser: vi.fn().mockResolvedValue({ uid: 'u1', role: 'admin' }),
    }));
    vi.doMock('../_lib/firebase-admin.js', () => ({
      getDb: () => ({
        doc: () => ({ get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ connectionId: 'conn-abc' }) }) }),
        collection: () => ({}),
      }),
    }));

    // Make the Salt Edge accounts fetch throw the Firestore-like error
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url) => {
      if (String(url).includes('/refresh')) return { json: async () => ({}) };
      throw FIRESTORE_INDEX_ERROR;
    }));

    const mod = await import('../_bank-refresh.js');
    const req = { method: 'POST', headers: { authorization: 'Bearer t' }, body: { connection_id: 'conn-abc' } };
    const res = mockRes();
    await mod.default(req, res);

    assertSanitized(res, 'Bank data refresh failed');
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// bank-transactions.js
// ---------------------------------------------------------------------------
describe('error-sanitization: bank-transactions.js (BUG #436)', () => {
  test('returns safe error string when Salt Edge fetch throws', async () => {
    vi.resetModules();
    vi.stubEnv('SALTEDGE_APP_ID', 'x');
    vi.stubEnv('SALTEDGE_SECRET', 'y');

    vi.doMock('../_lib/require-auth.js', () => ({
      requireUser: vi.fn().mockResolvedValue({ uid: 'u1', role: 'admin' }),
    }));
    vi.doMock('../_lib/firebase-admin.js', () => ({
      getDb: () => ({
        doc: () => ({ get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ connectionId: 'conn-abc' }) }) }),
      }),
    }));

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(FIRESTORE_INDEX_ERROR));

    const mod = await import('../_bank-transactions.js');
    const req = { method: 'POST', headers: { authorization: 'Bearer t' }, body: { connection_id: 'conn-abc' } };
    const res = mockRes();
    await mod.default(req, res);

    assertSanitized(res, 'Failed to fetch transactions');
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// sync-claim.js
// ---------------------------------------------------------------------------
describe('error-sanitization: sync-claim.js (BUG #436)', () => {
  test('returns safe error string when setCustomUserClaims throws', async () => {
    vi.resetModules();

    vi.doMock('../_lib/require-auth.js', () => ({
      requireUser: vi.fn().mockResolvedValue({ uid: 'u1' }),
    }));
    vi.doMock('../_lib/firebase-admin.js', () => ({
      getDb: () => ({
        collection: (col) => ({
          doc: (_id) => ({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => col === 'users'
                ? { orgId: 'org1', role: 'staff' }
                : { ownerUid: 'other', members: ['u1'] },
            }),
          }),
          where: () => ({ get: vi.fn().mockResolvedValue({ docs: [] }) }),
        }),
      }),
      getAuth: () => ({
        setCustomUserClaims: vi.fn().mockRejectedValue(FIRESTORE_INDEX_ERROR),
      }),
    }));

    const mod = await import('../_sync-claim.js');
    const req = { method: 'POST', headers: { authorization: 'Bearer t' }, body: { uid: 'u1' } };
    const res = mockRes();
    await mod.default(req, res);

    assertSanitized(res, 'Failed to sync claims');
  });
});

// ---------------------------------------------------------------------------
// delete-account.js
// ---------------------------------------------------------------------------
describe('error-sanitization: delete-account.js (BUG #436)', () => {
  test('returns safe error string on unexpected Firestore error', async () => {
    vi.resetModules();

    vi.doMock('../_lib/require-auth.js', () => ({
      requireUser: vi.fn().mockResolvedValue({ uid: 'owner-1' }),
    }));
    vi.doMock('../_lib/firebase-admin.js', () => ({
      getDb: () => ({
        collection: (col) => ({
          doc: (_id) => ({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => col === 'users'
                ? { orgId: 'org1', role: 'owner' }
                : { ownerUid: 'owner-1', name: 'MyOrg', members: ['owner-1'] },
            }),
            update: vi.fn().mockRejectedValue(FIRESTORE_INDEX_ERROR),
            delete: vi.fn().mockResolvedValue({}),
          }),
          where: () => ({
            get: vi.fn().mockResolvedValue({
              docs: [{ id: 'owner-1', data: () => ({ orgId: 'org1', role: 'owner' }) }],
            }),
          }),
        }),
        runTransaction: vi.fn(),
      }),
      getAuth: () => ({ deleteUser: vi.fn().mockResolvedValue({}) }),
      FieldValue: {
        serverTimestamp: () => 'SERVER_TS',
        arrayRemove: (v) => ({ _arrayRemove: v }),
        delete: () => ({ _delete: true }),
      },
    }));

    const mod = await import('../_delete-account.js');
    // 'delete-org' triggers an update that we've mocked to throw
    const req = { method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'delete-org', confirm: 'MyOrg' } };
    const res = mockRes();
    await mod.default(req, res);

    assertSanitized(res, 'Account deletion failed');
  });
});
