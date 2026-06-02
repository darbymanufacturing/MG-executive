/**
 * api/__tests__/cloudinary-sign.test.js
 *
 * Regression tests for bug #104 — Cloudinary upload preset is unsigned.
 * Tests the api/cloudinary-sign.js endpoint:
 *
 *   (1) Returns 401 when no Authorization header is present.
 *   (2) Returns 401 when the Firebase token is invalid (verifyIdToken throws).
 *   (3) Returns 200 with { signature, api_key, timestamp, cloud_name } for a
 *       valid token — signature must be a 40-char hex SHA-1 of the expected
 *       param string + CLOUDINARY_API_SECRET.
 *   (4) The timestamp in the response is within 5 seconds of Date.now() / 1000.
 *
 * Run with:  npx vitest run api/__tests__/cloudinary-sign.test.js
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';

// ── Mock require-auth.js ────────────────────────────────────────────────────────

let requireUserResult = { uid: 'test-uid', email: 'test@omni.com', role: null };
let requireUserShouldRespond = false; // when true, requireUser sends 401 itself (returns null)

vi.mock('../_lib/require-auth.js', () => ({
  requireUser: vi.fn(async (_req, res) => {
    if (requireUserShouldRespond) {
      res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
      return null;
    }
    return requireUserResult;
  }),
}));

// ── Mock firebase-admin.js (not called by cloudinary-sign, but required by require-auth) ──
vi.mock('../_lib/firebase-admin.js', () => ({
  getDb: vi.fn(),
  getAuth: vi.fn(() => ({ verifyIdToken: vi.fn() })),
  verifyIdToken: vi.fn(),
}));

// ── Env vars ────────────────────────────────────────────────────────────────────

const MOCK_CLOUD_NAME  = 'test-cloud';
const MOCK_API_KEY     = '123456789012345';
const MOCK_API_SECRET  = 'super-secret-value';

// ── Import handler after mocks ──────────────────────────────────────────────────
import handler from '../_cloudinary-sign.js';

// ── Helpers ─────────────────────────────────────────────────────────────────────

function makeReq(body = {}, { withAuth = true } = {}) {
  return {
    method: 'POST',
    headers: withAuth ? { authorization: 'Bearer valid-token' } : {},
    body,
  };
}

function makeRes() {
  const res = {
    _status: null,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body)   { this._body = body; return this; },
  };
  return res;
}

// Compute the expected SHA-1 signature for a given param set.
function expectedSignature(params, secret) {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.map((k) => `${k}=${params[k]}`).join('&');
  return crypto.createHash('sha1').update(paramString + secret).digest('hex');
}

beforeEach(() => {
  requireUserShouldRespond = false;
  requireUserResult = { uid: 'test-uid', email: 'test@omni.com', role: null };

  process.env.CLOUDINARY_CLOUD_NAME = MOCK_CLOUD_NAME;
  process.env.CLOUDINARY_API_KEY    = MOCK_API_KEY;
  process.env.CLOUDINARY_API_SECRET = MOCK_API_SECRET;
});

// ── Tests ────────────────────────────────────────────────────────────────────────

describe('cloudinary-sign — auth guard', () => {
  it('(1) returns 401 when no Authorization header is present', async () => {
    requireUserShouldRespond = true; // requireUser will call res.status(401) and return null

    const req = makeReq({}, { withAuth: false });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(401);
  });

  it('(2) returns 401 when the Firebase token is invalid', async () => {
    requireUserShouldRespond = true; // simulates verifyIdToken throwing

    const req = makeReq({ folder: 'repair-photos/s1', public_id: '1-ts' });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(401);
    expect(res._body.error).toMatch(/expired|invalid/i);
  });
});

describe('cloudinary-sign — successful signature generation', () => {
  const folder    = 'repair-photos/sess-abc';
  const public_id = '1-1700000000000';
  const context   = 'sessionId=sess-abc|stepNumber=1';

  it('(3) returns 200 with signature, api_key, timestamp, cloud_name', async () => {
    const req = makeReq({ folder, public_id, context });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toHaveProperty('signature');
    expect(res._body).toHaveProperty('api_key', MOCK_API_KEY);
    expect(res._body).toHaveProperty('timestamp');
    expect(res._body).toHaveProperty('cloud_name', MOCK_CLOUD_NAME);
  });

  it('(3) signature is a 40-char hex SHA-1 of the correct param string', async () => {
    const req = makeReq({ folder, public_id, context });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);

    const { signature, timestamp } = res._body;

    // Signature must be a 40-char lowercase hex string (SHA-1)
    expect(signature).toMatch(/^[0-9a-f]{40}$/);

    // Compute what the signature SHOULD be, given the returned timestamp
    const params = { context, folder, public_id, timestamp };
    const expected = expectedSignature(params, MOCK_API_SECRET);

    expect(signature).toBe(expected);
  });

  it('(4) timestamp is within 5 seconds of Date.now() / 1000', async () => {
    const beforeCall = Math.floor(Date.now() / 1000);

    const req = makeReq({ folder, public_id });
    const res = makeRes();
    await handler(req, res);

    const afterCall = Math.floor(Date.now() / 1000);

    expect(res._status).toBe(200);
    const { timestamp } = res._body;

    expect(timestamp).toBeGreaterThanOrEqual(beforeCall);
    expect(timestamp).toBeLessThanOrEqual(afterCall + 5);
  });
});
