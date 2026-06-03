/**
 * Regression tests for BUG #459:
 * bank-connections.js GET must verify the supplied customer_id matches the
 * stored customerId in config/bank (Firestore) before proxying to Salt Edge.
 * Without this check an authenticated user can enumerate any Salt Edge
 * customer by supplying an arbitrary customer_id in the query string (IDOR).
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

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

function mockReq(query = {}) {
  return { method: 'GET', headers: { authorization: 'Bearer fake-token' }, query };
}

// ---------------------------------------------------------------------------
// Load the handler with mocked deps
// ---------------------------------------------------------------------------
async function loadHandler({
  storedCustomerId = 'cust-123',
  bankDocExists = true,
  firestoreThrows = false,
  saltEdgeConnections = [{ id: 'conn-abc', provider_name: 'test_bank', status: 'active' }],
} = {}) {
  vi.resetModules();

  vi.stubEnv('SALTEDGE_APP_ID', 'test-app-id');
  vi.stubEnv('SALTEDGE_SECRET', 'test-secret');

  vi.doMock('../_lib/require-auth.js', () => ({
    requireUser: vi.fn().mockResolvedValue({ uid: 'user-1', email: 'test@test.com', role: 'admin' }),
  }));

  vi.doMock('../_lib/firebase-admin.js', () => ({
    getDb: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: firestoreThrows
          ? vi.fn().mockRejectedValue(new Error('Firestore unavailable'))
          : vi.fn().mockResolvedValue({
              exists: bankDocExists,
              data: () => (bankDocExists ? { customerId: storedCustomerId } : undefined),
            }),
      })),
    })),
  }));

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    json: async () => ({ data: saltEdgeConnections }),
  }));

  const mod = await import('../_bank-connections.js');
  return mod.default;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('bank-connections.js IDOR ownership check (BUG #459)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test('(1) matching customer_id passes through and returns 200 with connections list', async () => {
    const handler = await loadHandler({ storedCustomerId: 'cust-123' });
    const req = mockReq({ customer_id: 'cust-123' });
    const res = mockRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.connections).toHaveLength(1);
    expect(res._body.connections[0].id).toBe('conn-abc');
    // Confirm Salt Edge was actually called with the customer_id
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('customer_id=cust-123'),
      expect.anything()
    );
  });

  test('(2) mismatched customer_id returns 403 with "does not match"', async () => {
    const handler = await loadHandler({ storedCustomerId: 'cust-123' });
    const req = mockReq({ customer_id: 'cust-EVIL' });
    const res = mockRes();
    await handler(req, res);

    expect(res._status).toBe(403);
    expect(res._body.error).toMatch(/does not match/);
    // Salt Edge must NOT have been called
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  test('(3) no customer_id in request returns 400', async () => {
    const handler = await loadHandler();
    const req = mockReq({});
    const res = mockRes();
    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/customer_id required/);
  });

  test('(4) config/bank doc does not exist returns 403 "No bank connection configured"', async () => {
    const handler = await loadHandler({ bankDocExists: false });
    const req = mockReq({ customer_id: 'cust-123' });
    const res = mockRes();
    await handler(req, res);

    expect(res._status).toBe(403);
    expect(res._body.error).toMatch(/No bank connection configured/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  test('(5) Firestore read throws returns 500 "Could not verify"', async () => {
    const handler = await loadHandler({ firestoreThrows: true });
    const req = mockReq({ customer_id: 'cust-123' });
    const res = mockRes();
    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body.error).toMatch(/Could not verify/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
