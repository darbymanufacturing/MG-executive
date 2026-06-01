/**
 * Regression tests for the constant-time CRON_SECRET comparison in requireCronOrUser.
 * Bug #407: timing side channel via V8 short-circuit string equality.
 *
 * firebase-admin.js is mocked so no real Firebase credentials are needed.
 * verifyIdToken is set to reject by default — tests that reach it will get a 401.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock firebase-admin.js before importing require-auth so the module picks up fakes.
vi.mock('../firebase-admin.js', () => ({
  getDb: vi.fn(() => ({
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: vi.fn(async () => ({ exists: false, data: () => ({}) })),
      })),
    })),
  })),
  verifyIdToken: vi.fn(async () => {
    throw new Error('Invalid token');
  }),
}));

import { requireCronOrUser } from '../require-auth.js';

/** Build a minimal request object with a Bearer token in Authorization.
 *  Pass extraHeaders to add additional headers (e.g. { 'x-vercel-cron': '1' }).
 */
function makeReq(token, extraHeaders = {}) {
  return {
    headers: {
      authorization: token ? `Bearer ${token}` : '',
      ...extraHeaders,
    },
  };
}

/** Build a minimal response recorder — tracks status + body of the first response. */
function makeRes() {
  const res = {
    _status: null,
    _body: null,
    status(code) {
      res._status = code;
      return res;
    },
    json(body) {
      res._body = body;
      return res;
    },
  };
  return res;
}

const CORRECT_SECRET = 'super-secret-cron-token-abc123';

describe('requireCronOrUser — constant-time CRON_SECRET comparison (bug #407)', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = CORRECT_SECRET;
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    vi.clearAllMocks();
  });

  test('correct secret returns { trigger: "cron", uid: null, role: null }', async () => {
    // Vercel cron invocations always carry x-vercel-cron: 1.
    const req = makeReq(CORRECT_SECRET, { 'x-vercel-cron': '1' });
    const res = makeRes();
    const result = await requireCronOrUser(req, res);
    expect(result).toEqual({ trigger: 'cron', uid: null, role: null });
    // No HTTP response should have been sent.
    expect(res._status).toBeNull();
  });

  test('wrong secret (same length) does NOT grant cron access', async () => {
    // Flip the last character to produce a same-length wrong token.
    const lastChar = CORRECT_SECRET.at(-1);
    const flipped = CORRECT_SECRET.slice(0, -1) + (lastChar === 'X' ? 'Y' : 'X');
    expect(flipped.length).toBe(CORRECT_SECRET.length); // sanity

    const req = makeReq(flipped);
    const res = makeRes();
    const result = await requireCronOrUser(req, res);

    // Should fall through to requireUser which rejects the fake Firebase token.
    expect(result).toBeNull();
    expect(res._status).toBe(401);
  });

  test('wrong secret (different length) does NOT grant cron access', async () => {
    const shortSecret = CORRECT_SECRET.slice(0, -3); // 3 bytes shorter
    expect(shortSecret.length).not.toBe(CORRECT_SECRET.length); // sanity

    const req = makeReq(shortSecret);
    const res = makeRes();
    const result = await requireCronOrUser(req, res);

    expect(result).toBeNull();
    expect(res._status).toBe(401);
  });

  test('empty/missing CRON_SECRET env var with x-vercel-cron header returns 503 (misconfiguration)', async () => {
    delete process.env.CRON_SECRET;

    // Simulate a real Vercel cron invocation: infrastructure sets x-vercel-cron: 1.
    const req = makeReq(CORRECT_SECRET, { 'x-vercel-cron': '1' });
    const res = makeRes();
    const result = await requireCronOrUser(req, res);

    // CRON_SECRET not configured → operator must see 503, not a confusing 401.
    expect(result).toBeNull();
    expect(res._status).toBe(503);
    expect(res._body).toMatchObject({ error: expect.stringContaining('CRON_SECRET') });
  });

  test('no x-vercel-cron header + no CRON_SECRET + any token falls through to user auth (401)', async () => {
    delete process.env.CRON_SECRET;

    // No cron header — manual trigger path; should behave exactly as before.
    const req = makeReq(CORRECT_SECRET);
    const res = makeRes();
    const result = await requireCronOrUser(req, res);

    // Firebase token verification fails → 401. Non-cron paths are unaffected.
    expect(result).toBeNull();
    expect(res._status).toBe(401);
  });

  test('correct secret with one byte flipped does NOT grant access (regression for timingSafeEqual)', async () => {
    // Flip a byte in the MIDDLE of the token (not just the last char) to confirm
    // the constant-time comparison catches it regardless of position.
    const mid = Math.floor(CORRECT_SECRET.length / 2);
    const mutated =
      CORRECT_SECRET.slice(0, mid) +
      (CORRECT_SECRET[mid] === 'a' ? 'b' : 'a') +
      CORRECT_SECRET.slice(mid + 1);
    expect(mutated.length).toBe(CORRECT_SECRET.length);
    expect(mutated).not.toBe(CORRECT_SECRET);

    const req = makeReq(mutated);
    const res = makeRes();
    const result = await requireCronOrUser(req, res);

    expect(result).toBeNull();
    expect(res._status).toBe(401);
  });
});
