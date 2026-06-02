/**
 * api/__tests__/accountant-forward.streaming.test.js
 *
 * Regression tests for bug #434 — accountant-forward.js must stream the
 * attachment body incrementally and abort (via AbortController) the moment
 * accumulated bytes exceed MAX_ATTACHMENT_BYTES (10 MB), rather than
 * eagerly allocating the full body with arrayBuffer() before the size check.
 *
 * Run with:  npx vitest run api/__tests__/accountant-forward.streaming.test.js
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- Mock resend -------------------------------------------------------
const sendMock = vi.fn();

vi.mock('resend', () => ({
  Resend: vi.fn(() => ({
    emails: { send: sendMock },
  })),
}));

// --- Mock require-auth.js ----------------------------------------------
vi.mock('../_lib/require-auth.js', () => ({
  requireUser: vi.fn(async () => ({ uid: 'user-1', email: 'staff@mgexecutive.app', role: 'staff' })),
}));

// --- Import handler AFTER mocks ----------------------------------------
import handler from '../_accountant-forward.js';

// Minimal req/res helpers -----------------------------------------------
function makeReq(body = {}) {
  return { method: 'POST', body };
}

function makeRes() {
  const res = { _status: 200, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  return res;
}

const _MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB — must match handler constant

const BASE_BODY = {
  costId: 'cost-2',
  vendor: 'Acme',
  amount: 50,
  date: '2026-01-20',
  attachmentUrl: 'https://firebasestorage.googleapis.com/v0/b/mg-executive.appspot.com/o/big.pdf',
  attachmentName: 'big.pdf',
  senderEmail: 'staff@mgexecutive.app',
  senderName: 'Staff',
};

// Build a mock ReadableStream reader that emits chunkCount chunks each of
// chunkSize bytes, tracking how many chunks the consumer actually received
// before aborting.  Returns { reader, chunksRead }.
function _makeLargeStreamReader(chunkSize, chunkCount) {
  let index = 0;
  let chunksRead = 0;
  const reader = {
    read: async () => {
      if (index >= chunkCount) return { done: true, value: undefined };
      index++;
      chunksRead++;
      return { done: false, value: new Uint8Array(chunkSize) };
    },
  };
  return { reader, get chunksRead() { return chunksRead; } };
}

let abortCalled = false;

beforeEach(() => {
  vi.clearAllMocks();
  abortCalled = false;
  sendMock.mockResolvedValue({ data: { id: 'msg-2' }, error: null });
  process.env.RESEND_API_KEY = 'test-key';
  process.env.ACCOUNTANT_EMAIL = 'accountant@firm.com';
  process.env.RESEND_FROM_EMAIL = 'Omni <noreply@mgexecutive.app>';
});

// -----------------------------------------------------------------------
describe('Bug #434 — streaming size guard', () => {
  it('(a) stream >10 MB with no Content-Length — attachmentData is null and abort() is called', async () => {
    // 11 chunks of 1 MB each = 11 MB total — exceeds MAX_ATTACHMENT_BYTES after 11th chunk
    const CHUNK_SIZE = 1 * 1024 * 1024; // 1 MB
    const CHUNK_COUNT = 11;
    const { reader } = (() => {
      let index = 0;
      let chunksRead = 0;
      const reader = {
        read: async () => {
          if (index >= CHUNK_COUNT) return { done: true, value: undefined };
          index++;
          chunksRead++;
          return { done: false, value: new Uint8Array(CHUNK_SIZE) };
        },
      };
      return { reader, get chunksRead() { return chunksRead; } };
    })();

    global.AbortController = class {
      constructor() { this.signal = {}; }
      abort() { abortCalled = true; }
    };

    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      // No Content-Length header — pre-check passes, streaming kicks in
      headers: { get: () => null },
      body: { getReader: () => reader },
    });

    const req = makeReq(BASE_BODY);
    const res = makeRes();
    await handler(req, res);

    // Email still sends (without attachment)
    expect(res._status).toBe(200);
    const emailCall = sendMock.mock.calls[0][0];
    expect(emailCall).not.toHaveProperty('attachments');

    // AbortController.abort() must have been invoked
    expect(abortCalled).toBe(true);
  });

  it('(b) stream under 10 MB returns valid base64 attachment data', async () => {
    // 5 chunks of 1 MB each = 5 MB — under limit
    const CHUNK_SIZE = 1 * 1024 * 1024;
    const CHUNK_COUNT = 5;
    let index = 0;
    const reader = {
      read: async () => {
        if (index >= CHUNK_COUNT) return { done: true, value: undefined };
        index++;
        return { done: false, value: new Uint8Array(CHUNK_SIZE) };
      },
    };

    abortCalled = false;
    global.AbortController = class {
      constructor() { this.signal = {}; }
      abort() { abortCalled = true; }
    };

    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: () => null },
      body: { getReader: () => reader },
    });

    const req = makeReq(BASE_BODY);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    // Attachment should be embedded — the email payload has `attachments`
    const emailCall = sendMock.mock.calls[0][0];
    expect(emailCall.attachments).toBeDefined();
    expect(emailCall.attachments[0].filename).toBe('big.pdf');
    // base64 check: content is a non-empty string
    expect(typeof emailCall.attachments[0].content).toBe('string');
    expect(emailCall.attachments[0].content.length).toBeGreaterThan(0);

    // abort() must NOT have been called for a valid-size stream
    expect(abortCalled).toBe(false);
  });
});
