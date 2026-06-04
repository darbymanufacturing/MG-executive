/**
 * api/__tests__/sync-claim.test.js
 *
 * Regression tests for bug #411 — sync-claim.js must not mint a privileged
 * custom claim (owner / admin) without cross-checking against the org doc.
 *
 * ADR-0023 Stage-1: identity reads now come from Supabase (sbGetDoc), so mocks
 * target _lib/supabase-admin.js instead of the old Firestore getDb() chain.
 *
 * Run with:  npx vitest run api/__tests__/sync-claim.test.js
 * (The default vitest.config.js covers src/ only; these tests are designed to
 * be run directly with vitest or via an extended include pattern.)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- Mock firebase-admin.js (Auth only — getDb is no longer used) ----------
const setCustomUserClaimsMock = vi.fn().mockResolvedValue(undefined);

// Default getUser returns no pre-existing custom claims; override per test.
let getUserMock = vi.fn().mockResolvedValue({ customClaims: {} });

vi.mock('../_lib/firebase-admin.js', () => ({
  // getDb is intentionally NOT exported here — sync-claim no longer calls it.
  getAuth: () => ({
    setCustomUserClaims: setCustomUserClaimsMock,
    getUser: (...args) => getUserMock(...args),
  }),
}));

// --- Mock supabase-admin.js (identity reads — ADR-0023 Stage-1) -------------
// sbGetDoc(table, sourceDocId) returns { _docId: sourceDocId, ...data } or null.
// We keep a simple lookup map keyed by `${table}/${sourceDocId}`.
let sbDocMocks = {};

const sbGetDocMock = vi.fn(async (table, sourceDocId) => {
  const key = `${table}/${sourceDocId}`;
  const data = sbDocMocks[key] ?? null;
  if (!data) return null;
  return { _docId: sourceDocId, ...data };
});

vi.mock('../_lib/supabase-admin.js', () => ({
  sbGetDoc: (...args) => sbGetDocMock(...args),
}));

// --- Mock require-auth.js — caller is always the targetUid by default -------
let callerUidMock = 'attacker-uid';

vi.mock('../_lib/require-auth.js', () => ({
  requireUser: vi.fn(async (_req, _res) => ({ uid: callerUidMock, email: 'test@test.com', role: null })),
}));

// --- Import handler AFTER mocks are in place --------------------------------
import handler from '../_sync-claim.js';

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
  sbDocMocks = {};
  callerUidMock = 'attacker-uid';
  getUserMock = vi.fn().mockResolvedValue({ customClaims: {} });
});

// ---------------------------------------------------------------------------
// Case 1: Attacker writes users/{uid}.role='owner' but org.ownerUid differs
// ---------------------------------------------------------------------------
describe('bug-411 — owner role escalation blocked', () => {
  it('returns 403 when users/{uid}.role=owner but org.ownerUid is a different uid', async () => {
    const attackerUid = 'attacker-uid';
    callerUidMock = attackerUid;

    sbDocMocks[`users/${attackerUid}`] = {
      orgId: 'org-123',
      role: 'owner',        // attacker set their own role to owner in the store
    };
    sbDocMocks['organizations/org-123'] = {
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

    sbDocMocks[`users/${ownerUid}`] = {
      orgId: 'org-123',
      role: 'owner',
    };
    sbDocMocks['organizations/org-123'] = {
      ownerUid: ownerUid,           // matches — this is genuinely the owner
      members: [ownerUid],
    };

    const req = makeReq({});
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(setCustomUserClaimsMock).toHaveBeenCalledWith(ownerUid, { orgId: 'org-123', role: 'authenticated', user_role: 'owner' });
  });
});

// ---------------------------------------------------------------------------
// Case 3: role='admin' where targetUid is not in org.members → 403
// ---------------------------------------------------------------------------
describe('bug-411 — admin role escalation blocked when not in members', () => {
  it('returns 403 when role=admin but targetUid absent from org.members', async () => {
    const attackerUid = 'attacker-uid';
    callerUidMock = attackerUid;

    sbDocMocks[`users/${attackerUid}`] = {
      orgId: 'org-123',
      role: 'admin',
    };
    sbDocMocks['organizations/org-123'] = {
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

    sbDocMocks[`users/${staffUid}`] = {
      orgId: 'org-123',
      role: 'staff',
    };
    // organizations/org-123 deliberately absent — would 400 if fetched
    // (no entry in sbDocMocks)

    const req = makeReq({});
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(setCustomUserClaimsMock).toHaveBeenCalledWith(staffUid, { orgId: 'org-123', role: 'authenticated', user_role: 'staff' });
    // Verify the organizations table was never queried
    const orgCalls = sbGetDocMock.mock.calls.filter(([tbl]) => tbl === 'organizations');
    expect(orgCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Case 5 (bug-458): pre-existing claims are preserved across a sync call
// ---------------------------------------------------------------------------
describe('bug-458 — pre-existing custom claims survive sync', () => {
  it('merges tenancy claims on top of pre-existing claims without discarding them', async () => {
    const ownerUid = 'real-owner-uid';
    callerUidMock = ownerUid;

    sbDocMocks[`users/${ownerUid}`] = {
      orgId: 'org-123',
      role: 'owner',
    };
    sbDocMocks['organizations/org-123'] = {
      ownerUid: ownerUid,
      members: [ownerUid],
    };

    // Simulate a pre-existing claim written by another endpoint (e.g. Stripe)
    getUserMock = vi.fn().mockResolvedValue({
      customClaims: { stripeCustomerId: 'cus_abc' },
    });

    const req = makeReq({});
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);

    // getUser must have been called to read the existing claims
    expect(getUserMock).toHaveBeenCalledWith(ownerUid);

    // The merged claims object must contain BOTH the pre-existing key AND all
    // three tenancy keys overwritten with authoritative values.
    expect(setCustomUserClaimsMock).toHaveBeenCalledWith(ownerUid, {
      stripeCustomerId: 'cus_abc',
      orgId: 'org-123',
      role: 'authenticated',
      user_role: 'owner',
    });
  });
});

// ---------------------------------------------------------------------------
// Case 6: cross-user sync by a same-org admin — authorized
// ---------------------------------------------------------------------------
describe('cross-user sync — same-org admin authorized', () => {
  it('allows an admin to sync a different user in the same org', async () => {
    const adminUid = 'admin-uid';
    const targetUid = 'staff-uid';
    callerUidMock = adminUid;

    sbDocMocks[`users/${targetUid}`] = {
      orgId: 'org-123',
      role: 'staff',
    };
    sbDocMocks[`users/${adminUid}`] = {
      orgId: 'org-123',
      role: 'admin',
    };

    const req = makeReq({ uid: targetUid });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(setCustomUserClaimsMock).toHaveBeenCalledWith(targetUid, { orgId: 'org-123', role: 'authenticated', user_role: 'staff' });
  });
});

// ---------------------------------------------------------------------------
// Case 7: cross-user sync by a different-org admin — 403
// ---------------------------------------------------------------------------
describe('cross-user sync — different-org admin blocked', () => {
  it('returns 403 when caller admin is in a different org than the target', async () => {
    const adminUid = 'admin-other-org';
    const targetUid = 'staff-uid';
    callerUidMock = adminUid;

    sbDocMocks[`users/${targetUid}`] = {
      orgId: 'org-123',
      role: 'staff',
    };
    sbDocMocks[`users/${adminUid}`] = {
      orgId: 'org-999',  // different org
      role: 'admin',
    };

    const req = makeReq({ uid: targetUid });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(403);
    expect(res._body.error).toMatch(/You can only sync your own claims/);
    expect(setCustomUserClaimsMock).not.toHaveBeenCalled();
  });
});
