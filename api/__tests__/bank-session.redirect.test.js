/**
 * Regression tests for BUG #433:
 * bank-session.js redirect_url validation must use URL-parsed origin equality,
 * not startsWith(), to prevent subdomain-confusion open-redirect attacks.
 *
 * e.g. https://omni.mgexecutive.app.evil.com/steal starts with the legitimate
 * origin string but has a completely different parsed origin — it must be rejected.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const ORIGIN = 'https://omni.mgexecutive.app';

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

function mockReq(body) {
  return { method: 'POST', headers: { authorization: 'Bearer fake-token' }, body };
}

// ---------------------------------------------------------------------------
// Load the handler with mocked deps
// ---------------------------------------------------------------------------
async function loadHandler({ connectUrl = 'https://saltedge.example.com/connect/abc' } = {}) {
  vi.resetModules();

  // Mock Salt Edge fetch: customer creation + session creation
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url) => {
    if (String(url).includes('/customers')) {
      return { json: async () => ({ data: { id: 'cust-123' } }) };
    }
    if (String(url).includes('/connect_sessions')) {
      return { json: async () => ({ data: { connect_url: connectUrl } }) };
    }
    return { json: async () => ({}) };
  }));

  // Stub env vars
  vi.stubEnv('SALTEDGE_APP_ID', 'test-app-id');
  vi.stubEnv('SALTEDGE_SECRET', 'test-secret');
  vi.stubEnv('APP_ORIGIN', ORIGIN);

  vi.doMock('../_lib/require-auth.js', () => ({
    requireUser: vi.fn().mockResolvedValue({ uid: 'user-1', email: 'test@test.com', role: 'admin' }),
  }));

  const mod = await import('../_bank-session.js');
  return mod.default;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('bank-session.js redirect_url validation (BUG #433)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test('same-origin URL is accepted and passed through to Salt Edge', async () => {
    const handler = await loadHandler();
    const legitimateUrl = `${ORIGIN}/settings?tab=bank`;
    const req = mockReq({ redirect_url: legitimateUrl });
    const res = mockRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    // The connect_url is returned, not the redirect — just confirm success
    expect(res._body.connect_url).toBeTruthy();
    // Verify the redirect URL sent to Salt Edge included our legit URL
    const sessionCall = vi.mocked(fetch).mock.calls.find(([url]) =>
      String(url).includes('/connect_sessions')
    );
    expect(sessionCall).toBeTruthy();
    const bodyParsed = JSON.parse(sessionCall[1].body);
    expect(bodyParsed.data.attempt.return_to).toBe(legitimateUrl);
  });

  test('subdomain-confusion URL is rejected and falls back to /settings', async () => {
    const handler = await loadHandler();
    const evilUrl = `${ORIGIN}.evil.com/steal`;
    const req = mockReq({ redirect_url: evilUrl });
    const res = mockRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    const sessionCall = vi.mocked(fetch).mock.calls.find(([url]) =>
      String(url).includes('/connect_sessions')
    );
    expect(sessionCall).toBeTruthy();
    const bodyParsed = JSON.parse(sessionCall[1].body);
    expect(bodyParsed.data.attempt.return_to).toBe(`${ORIGIN}/settings`);
    expect(bodyParsed.data.attempt.return_to).not.toContain('evil.com');
  });

  test('completely different origin URL is rejected and falls back to /settings', async () => {
    const handler = await loadHandler();
    const foreignUrl = 'https://attacker.com/steal';
    const req = mockReq({ redirect_url: foreignUrl });
    const res = mockRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    const sessionCall = vi.mocked(fetch).mock.calls.find(([url]) =>
      String(url).includes('/connect_sessions')
    );
    expect(sessionCall).toBeTruthy();
    const bodyParsed = JSON.parse(sessionCall[1].body);
    expect(bodyParsed.data.attempt.return_to).toBe(`${ORIGIN}/settings`);
  });

  test('malformed URL string does not throw and falls back to default', async () => {
    const handler = await loadHandler();
    const req = mockReq({ redirect_url: 'not a url @@##$$' });
    const res = mockRes();
    await handler(req, res);

    // Should not throw — handler returns 200 with fallback redirect
    expect(res._status).toBe(200);
    const sessionCall = vi.mocked(fetch).mock.calls.find(([url]) =>
      String(url).includes('/connect_sessions')
    );
    expect(sessionCall).toBeTruthy();
    const bodyParsed = JSON.parse(sessionCall[1].body);
    expect(bodyParsed.data.attempt.return_to).toBe(`${ORIGIN}/settings`);
  });
});
