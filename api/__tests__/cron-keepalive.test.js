/**
 * api/__tests__/cron-keepalive.test.js
 *
 * Regression tests for #691 — nothing kept the free-tier Supabase project
 * awake, so it auto-paused on 2026-09-07 and locked the owner out.
 *
 * The keep-alive cron must:
 *   (1) reject non-GET/POST methods
 *   (2) run a real Supabase read and return ok:true (the pause-preventing work)
 *   (3) ping the heartbeat ONLY on verified success
 *   (4) return 502 + a FAIL heartbeat when the probe errors (paused project)
 *   (5) return 503 + a FAIL heartbeat when the admin client is unavailable
 *
 * Run with:  npx vitest run api/__tests__/cron-keepalive.test.js
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────────────

let authResult = { trigger: 'cron' };
vi.mock('../_lib/require-auth.js', () => ({
  requireCronOrUser: vi.fn(async (_req, res) => {
    if (!authResult) {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    }
    return authResult;
  }),
}));

let probeResult = { error: null, count: 3 };
let adminThrows = null;
vi.mock('../_lib/supabase-admin.js', () => ({
  supabaseAdmin: vi.fn(() => {
    if (adminThrows) throw new Error(adminThrows);
    return {
      from: () => ({
        select: () => Promise.resolve(probeResult),
      }),
    };
  }),
}));

const heartbeatOkMock = vi.fn(async () => true);
const heartbeatFailMock = vi.fn(async () => true);
vi.mock('../_lib/heartbeat.js', () => ({
  heartbeatOk: (...args) => heartbeatOkMock(...args),
  heartbeatFail: (...args) => heartbeatFailMock(...args),
}));

const { default: handler } = await import('../_cron-keepalive.js');

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

beforeEach(() => {
  authResult = { trigger: 'cron' };
  probeResult = { error: null, count: 3 };
  adminThrows = null;
  heartbeatOkMock.mockClear();
  heartbeatFailMock.mockClear();
});

describe('cron-keepalive', () => {
  it('(1) rejects methods other than GET/POST', async () => {
    const res = mockRes();
    await handler({ method: 'DELETE', query: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it('(2) performs the probe and reports ok', async () => {
    const res = mockRes();
    await handler({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.table).toBe('organizations');
    expect(typeof res.body.latencyMs).toBe('number');
  });

  it('(3) pings the heartbeat only on verified success', async () => {
    const res = mockRes();
    await handler({ method: 'POST', query: {} }, res);
    expect(heartbeatOkMock).toHaveBeenCalledTimes(1);
    expect(heartbeatOkMock.mock.calls[0][0]).toBe('HEARTBEAT_KEEPALIVE');
    expect(heartbeatFailMock).not.toHaveBeenCalled();
  });

  it('(4) returns 502 and fails the heartbeat when the probe errors', async () => {
    probeResult = { error: { message: 'project is paused' }, count: null };
    const res = mockRes();
    await handler({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(502);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/paused/i);
    expect(heartbeatFailMock).toHaveBeenCalledTimes(1);
    expect(heartbeatOkMock).not.toHaveBeenCalled();
  });

  it('(5) returns 503 and fails the heartbeat when the admin client is unavailable', async () => {
    adminThrows = 'SUPABASE_URL missing';
    const res = mockRes();
    await handler({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(heartbeatFailMock).toHaveBeenCalledTimes(1);
  });

  it('(6) does nothing when auth fails', async () => {
    authResult = null;
    const res = mockRes();
    await handler({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(401);
    expect(heartbeatOkMock).not.toHaveBeenCalled();
    expect(heartbeatFailMock).not.toHaveBeenCalled();
  });
});
