/**
 * api/__tests__/sync-claim.test.js
 *
 * Regression tests for bug #411 — sync-claim.js must not mint a privileged
 * custom claim (owner / admin) without cross-checking against the org doc.
 *
 * Run with:  npx vitest run api/__tests__/sync-claim.test.js
 * (The default vitest.config.js covers src/ only; these tests are designed to
 * be run directly with vitest or via an extended include pattern.)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- Mock firebase-admin.js -------------------------------------------
const setCustomUserClaimsMock = vi.fn().mockResolvedValue(undefined);

// Build a chainable Firestore mock whose .get() resolves per-collection/doc.
let firestoreDocMocks = {};

function makeDoc(data) {
  return { exists: data !== null, data: () => data };
}

const dbMock = {
  collection: vi.fn((col) => ({
    doc: vi.fn((docId) => ({
      get: vi.fn(() => {
        const key = `${col}/${docId}`;
        const data = firestoreDocMocks[key] ?? null;
        return Promise.resolve(makeDoc(data));
      }),
    })),
  })),
};

vi.mock('../_lib/firebase-admin.js', () => ({
  getDb: () => dbMock,
  getAuth: () => ({ setCustomUserClaims: setCustomUserClaimsMock }),
}));

// --- Mock require-auth.js — caller is always the targetUid by default ---
let callerUidMock = 'attacker-uid';

vi.mock('../_lib/require-auth.js', () => ({
  requireUser: vi.fn(async (_req, _res) => ({ uid: callerUidMock, email: 'test@test.com', role: null })),
}));

// --- Import handler AFTER mocks are in place ----------------------------
import handler from '../sync-claim.js';

// Minimal req/res helpers
function makeReq(body = {}) {
  return { method: 'POST', body, headers: { authorization: 'Bearer fake-token' } };
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
  vi.clearAllMocks();
  firestoreDocMocks = {};
  callerUidMock = 'attacker-uid';
});

// ---------------------------------------------------------------------------
// Case 1: Attacker writes users/{uid}.role='owner' but org.ownerUid differs
// ---------------------------------------------------------------------------
describe('bug-411 — owner role escalation blocked', () => {
  it('returns 403 when users/{uid}.role=owner but org.ownerUid is a different uid', async () => {
    const attackerUid = 'attacker-uid';
    callerUidMock = attackerUid;

    firestoreDocMocks[`users/${attackerUid}`] = {
      orgId: 'org-123',
      role: 'owner',        // attacker set their own role to owner in Firestore
    };
    firestoreDocMocks['organizations/org-123'] = {
      ownerUid: 'real-owner-uid', // org says a different uid is owner
      members: ['real-owner-uid', attackerUid],
    };

    const req = makeReq({});     // sync own claims (no uid body param)
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(403);
    expect(res._body.error).toMatch(/role:owner claim refused/);
    expect(setCustomUserClaimsMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Case 2: Legitimate owner — org.ownerUid matches targetUid → 200 + claim set
// ---------------------------------------------------------------------------
describe('bug-411 — legitimate owner claim allowed', () => {
  it('calls setCustomUserClaims and returns 200 when org.ownerUid === targetUid', async () => {
    const ownerUid = 'real-owner-uid';
    callerUidMock = ownerUid;

    firestoreDocMocks[`users/${ownerUid}`] = {
      orgId: 'org-123',
      role: 'owner',
    };
    firestoreDocMocks['organizations/org-123'] = {
      ownerUid: ownerUid,           // matches — this is genuinely the owner
      members: [ownerUid],
    };

    const req = makeReq({});
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(setCustomUserClaimsMock).toHaveBeenCalledWith(ownerUid, { orgId: 'org-123', role: 'owner' });
  });
});

// ---------------------------------------------------------------------------
// Case 3: role='admin' where targetUid is not in org.members → 403
// ---------------------------------------------------------------------------
describe('bug-411 — admin role escalation blocked when not in members', () => {
  it('returns 403 when role=admin but targetUid absent from org.members', async () => {
    const attackerUid = 'attacker-uid';
    callerUidMock = attackerUid;

    firestoreDocMocks[`users/${attackerUid}`] = {
      orgId: 'org-123',
      role: 'admin',
    };
    firestoreDocMocks['organizations/org-123'] = {
      ownerUid: 'real-owner-uid',
      members: ['real-owner-uid', 'other-member-uid'], // attacker NOT in members
    };

    const req = makeReq({});
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(403);
    expect(res._body.error).toMatch(/role:admin claim refused/);
    expect(setCustomUserClaimsMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Case 4: role='staff' (non-privileged) — no org fetch, claim minted directly
// ---------------------------------------------------------------------------
describe('bug-411 — non-privileged role bypasses org check', () => {
  it('mints the claim for role=staff without fetching the org doc', async () => {
    const staffUid = 'staff-uid';
    callerUidMock = staffUid;

    firestoreDocMocks[`users/${staffUid}`] = {
      orgId: 'org-123',
      role: 'staff',
    };
    // organizations/org-123 deliberately absent — would 400 if fetched
    // (no entry in firestoreDocMocks)

    const req = makeReq({});
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(setCustomUserClaimsMock).toHaveBeenCalledWith(staffUid, { orgId: 'org-123', role: 'staff' });
    // Verify the organizations collection was never queried
    const colCalls = dbMock.collection.mock.calls.map((c) => c[0]);
    expect(colCalls).not.toContain('organizations');
  });
});
