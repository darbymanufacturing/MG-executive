/**
 * api/__tests__/accountant-forward.test.js
 *
 * Regression tests for bug #431 — accountant-forward.js must not accept
 * accountantEmail, fromEmail body fields as overrides, and must validate
 * senderEmail against the authenticated user's own email before using it
 * as Reply-To.
 *
 * Run with:  npx vitest run api/__tests__/accountant-forward.test.js
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- Mock resend -------------------------------------------------------
const sendMock = vi.fn();

vi.mock('resend', () => ({
  Resend: vi.fn(() => ({
    emails: { send: sendMock },
  })),
}));

// --- Mock require-auth.js — returns a controllable authUser -------------
let authUserMock = { uid: 'user-1', email: 'staff@mgexecutive.app', role: 'staff' };

vi.mock('../_lib/require-auth.js', () => ({
  requireUser: vi.fn(async (_req, _res, _opts) => authUserMock),
}));

// --- Import handler AFTER mocks -----------------------------------------
import handler from '../accountant-forward.js';

// Minimal req/res helpers ------------------------------------------------
function makeReq(body = {}) {
  return { method: 'POST', body };
}

function makeRes() {
  const res = { _status: 200, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  return res;
}

// Valid base body that always satisfies pre-checks -----------------------
const VALID_BASE_BODY = {
  costId: 'cost-1',
  vendor: 'Acme',
  amount: 100,
  date: '2026-01-15',
  attachmentUrl: 'https://firebasestorage.googleapis.com/v0/b/mg-executive.appspot.com/o/invoice.pdf',
  attachmentName: 'invoice.pdf',
  senderEmail: 'staff@mgexecutive.app',
  senderName: 'Staff User',
};

// Stub fetch so attachment fetch does not hit the network ----------------
function stubFetchOk(sizeBytes = 1024) {
  const data = new Uint8Array(sizeBytes);
  global.fetch = vi.fn().mockResolvedValue({
    status: 200,
    ok: true,
    headers: { get: () => String(sizeBytes) },
    body: {
      getReader: () => {
        let done = false;
        return {
          read: async () => {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: data };
          },
        };
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockResolvedValue({ data: { id: 'msg-1' }, error: null });
  authUserMock = { uid: 'user-1', email: 'staff@mgexecutive.app', role: 'staff' };
  process.env.RESEND_API_KEY = 'test-key';
  process.env.ACCOUNTANT_EMAIL = 'accountant@firm.com';
  process.env.RESEND_FROM_EMAIL = 'Omni <noreply@mgexecutive.app>';
  stubFetchOk();
});

// -----------------------------------------------------------------------
describe('Bug #431 — spam relay prevention', () => {
  it('(a) ignores accountantEmail body field — to always uses ACCOUNTANT_EMAIL env', async () => {
    const req = makeReq({ ...VALID_BASE_BODY, accountantEmail: 'attacker@evil.com' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    const call = sendMock.mock.calls[0][0];
    expect(call.to).toEqual(['accountant@firm.com']);
    expect(call.to).not.toContain('attacker@evil.com');
  });

  it('(b) ignores fromEmail body field — from always uses RESEND_FROM_EMAIL env', async () => {
    const req = makeReq({ ...VALID_BASE_BODY, fromEmail: 'spoofed@other.com' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    const call = sendMock.mock.calls[0][0];
    expect(call.from).toBe('Omni <noreply@mgexecutive.app>');
    expect(call.from).not.toContain('spoofed@other.com');
  });

  it('(c) senderEmail matching authUser.email sets replyTo correctly', async () => {
    // authUserMock.email === VALID_BASE_BODY.senderEmail
    const req = makeReq({ ...VALID_BASE_BODY, senderEmail: 'staff@mgexecutive.app' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    const call = sendMock.mock.calls[0][0];
    expect(call.replyTo).toBe('staff@mgexecutive.app');
  });

  it('(d) senderEmail NOT matching authUser.email — replyTo absent from payload', async () => {
    const req = makeReq({ ...VALID_BASE_BODY, senderEmail: 'fakeceo@victim.com' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    const call = sendMock.mock.calls[0][0];
    expect(call).not.toHaveProperty('replyTo');
  });

  it('(e) missing ACCOUNTANT_EMAIL env var returns HTTP 500', async () => {
    delete process.env.ACCOUNTANT_EMAIL;
    const req = makeReq(VALID_BASE_BODY);
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(res._body.error).toMatch(/ACCOUNTANT_EMAIL not configured/i);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
