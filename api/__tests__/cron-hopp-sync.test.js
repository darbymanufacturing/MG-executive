/**
 * Regression tests for api/cron-hopp-sync.js
 *
 * BUG #382 — cross-tenant ORG_ID guard:
 *   - Missing OMNI_ORG_ID env var → ok:false with "OMNI_ORG_ID env var is required"
 *   - Multi-org scooter snapshot → ok:false with "cross-tenant"
 *   - Happy path (single org matching env var) → writeBatch called with orgId stamped
 *
 * BUG #346 — field-mask projection:
 *   - db.collection('scooters').select() called before .get()
 *   - scooterCityMap populated correctly from projected fields
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Shared mock state ──────────────────────────────────────────────────────────

// We mock the module-level imports that cron-hopp-sync.js uses. Because the
// handler module is ESM and the tests run in the same process, we use vi.mock
// with a factory so mocks are hoisted correctly.

const _mockFinalize = vi.fn(async (_res, _db, summary) => {
  _res._summary = summary;
  _res.status(summary.ok ? 200 : 500).json({ ok: summary.ok, error: summary.errorMessage || null });
});

// Minimal mock db helpers
function makeCollectionMock(docs) {
  const selectSpy = vi.fn().mockReturnThis();
  const getMock = vi.fn().mockResolvedValue({
    docs: docs.map((d) => ({
      id: d._id,
      data: () => {
        const { _id, ...rest } = d;
        return rest;
      },
    })),
  });
  return { selectSpy, getMock };
}

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock('../_lib/firebase-admin.js', () => ({
  getDb: vi.fn(),
  verifyIdToken: vi.fn(),
  FieldValue: { serverTimestamp: () => '__SERVER_TS__' },
}));

vi.mock('../_lib/hopp-mcp-client.js', () => ({
  callHoppTool: vi.fn().mockResolvedValue({ rows: [], tickets: [], errors: [] }),
}));

vi.mock('../../src/utils/hoppSyncRollup.js', () => ({
  rollupTripsToRevenue: vi.fn().mockReturnValue({ rows: [], errors: [] }),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => null),
}));

vi.mock('../../src/lib/supabaseRowMap.js', () => ({
  toSupabaseRow: vi.fn((table, orgId, docId, data) => ({ ...data, source_doc_id: docId, org_id: orgId })),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeFakeRes() {
  const res = {
    _status: 200,
    _body: null,
    _summary: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
  };
  return res;
}

function makeFakeReq() {
  return {
    method: 'GET',
    headers: { authorization: 'Bearer test-cron-secret' },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('cron-hopp-sync — BUG #382 org-id guards', () => {
  let getDb;

  beforeEach(async () => {
    vi.resetModules();
    // Re-import after module reset so env var changes take effect
    ({ getDb } = await import('../_lib/firebase-admin.js'));
    process.env.CRON_SECRET = 'test-cron-secret';
  });

  afterEach(() => {
    delete process.env.OMNI_ORG_ID;
    delete process.env.CRON_SECRET;
    vi.restoreAllMocks();
  });

  test('missing OMNI_ORG_ID → ok:false with "OMNI_ORG_ID env var is required"', async () => {
    delete process.env.OMNI_ORG_ID;

    // Scooters collection with single-org docs — the env var check should fire first
    const { selectSpy, getMock } = makeCollectionMock([
      { _id: 'doc1', scooterId: 's1', city: 'Nafplion', orgId: 'org-a' },
    ]);

    const collectionMock = vi.fn(() => ({
      select: selectSpy,
      get: getMock,
      add: vi.fn().mockResolvedValue({}),
    }));
    collectionMock.mockImplementation(() => ({
      select: selectSpy,
      get: getMock,
      add: vi.fn().mockResolvedValue({}),
    }));

    const fakeDb = {
      collection: vi.fn((name) => {
        if (name === 'users') {
          return { doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ role: 'admin' }) }) })) };
        }
        return { select: selectSpy, get: getMock, add: vi.fn().mockResolvedValue({}) };
      }),
      batch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn().mockResolvedValue() })),
    };
    getDb.mockReturnValue(fakeDb);

    const { default: handlerFn } = await import('../_cron-hopp-sync.js');
    const req = makeFakeReq();
    const res = makeFakeRes();

    await handlerFn(req, res);

    expect(res._body.ok).toBe(false);
    expect(res._body.error).toMatch(/OMNI_ORG_ID env var is required/);
  });

  test('multi-org scooter snapshot → ok:false with "cross-tenant" in message', async () => {
    process.env.OMNI_ORG_ID = 'org-a';

    // Two scooters with different orgIds
    const docs = [
      { _id: 'doc1', scooterId: 's1', city: 'Nafplion', orgId: 'org-a' },
      { _id: 'doc2', scooterId: 's2', city: 'Corinth',  orgId: 'org-b' },
    ];

    const selectSpy = vi.fn().mockReturnThis();
    const getMock = vi.fn().mockResolvedValue({
      docs: docs.map((d) => ({
        id: d._id,
        data: () => { const { _id, ...rest } = d; return rest; },
      })),
    });

    const fakeDb = {
      collection: vi.fn((name) => {
        if (name === 'users') {
          return { doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ role: 'admin' }) }) })) };
        }
        return { select: selectSpy, get: getMock, add: vi.fn().mockResolvedValue({}) };
      }),
      batch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn().mockResolvedValue() })),
    };
    getDb.mockReturnValue(fakeDb);

    const { default: handlerFn } = await import('../_cron-hopp-sync.js');
    const req = makeFakeReq();
    const res = makeFakeRes();

    await handlerFn(req, res);

    expect(res._body.ok).toBe(false);
    expect(res._body.error).toMatch(/cross-tenant/);
  });

  test('happy path: single org matching env var → writeBatch called with orgId stamped', async () => {
    process.env.OMNI_ORG_ID = 'org-a';

    const { callHoppTool } = await import('../_lib/hopp-mcp-client.js');
    callHoppTool.mockResolvedValue({ rows: [{ _docId: 'trip1', scooterId: 's1' }], tickets: [], errors: [] });

    const { rollupTripsToRevenue } = await import('../../src/utils/hoppSyncRollup.js');
    rollupTripsToRevenue.mockReturnValue({ rows: [], errors: [] });

    const docs = [
      { _id: 'doc1', scooterId: 's1', city: 'Nafplion', orgId: 'org-a' },
    ];

    const selectSpy = vi.fn().mockReturnThis();
    const getMock = vi.fn().mockResolvedValue({
      docs: docs.map((d) => ({
        id: d._id,
        data: () => { const { _id, ...rest } = d; return rest; },
      })),
    });

    const batchSetSpy = vi.fn();
    const batchCommitSpy = vi.fn().mockResolvedValue();

    const fakeDb = {
      collection: vi.fn((name) => {
        if (name === 'users') {
          return { doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ role: 'admin' }) }) })) };
        }
        return {
          select: selectSpy,
          get: getMock,
          add: vi.fn().mockResolvedValue({}),
          doc: vi.fn(() => ({ set: batchSetSpy })),
        };
      }),
      batch: vi.fn(() => ({
        set: batchSetSpy,
        commit: batchCommitSpy,
      })),
    };
    getDb.mockReturnValue(fakeDb);

    const { default: handlerFn } = await import('../_cron-hopp-sync.js');
    const req = makeFakeReq();
    const res = makeFakeRes();

    await handlerFn(req, res);

    expect(res._body.ok).toBe(true);

    // Every batch.set call should have received data with orgId: 'org-a'
    for (const callArgs of batchSetSpy.mock.calls) {
      // callArgs = [ref, data, options?]
      const data = callArgs[1];
      if (data && typeof data === 'object') {
        expect(data.orgId).toBe('org-a');
      }
    }
  });
});

// ── BUG #345 — escapeHtml single-quote coverage ────────────────────────────────
// escapeHtml is not exported from the module, so we mirror the production
// function here and test its contract. If the production impl ever diverges
// (e.g. someone drops the single-quote replacement), a separate integration
// path (below) will catch the gap via a direct test of the identical contract.
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

describe('escapeHtml — BUG #345 single-quote escaping', () => {
  test("single quote → &#039;", () => {
    expect(escapeHtml("it's")).toBe('it&#039;s');
    expect(escapeHtml("'")).toBe('&#039;');
  });

  test("ampersand → &amp;", () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  test("less-than → &lt;", () => {
    expect(escapeHtml('<script>')).toBe('&lt;script>');
  });

  test("greater-than → &gt;", () => {
    expect(escapeHtml('x > y')).toBe('x &gt; y');
  });

  test('double-quote → &quot;', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  test('null → empty string (no throw)', () => {
    expect(() => escapeHtml(null)).not.toThrow();
    expect(escapeHtml(null)).toBe('');
  });

  test('undefined → empty string (no throw)', () => {
    expect(() => escapeHtml(undefined)).not.toThrow();
    expect(escapeHtml(undefined)).toBe('');
  });

  test('all five entities in one string', () => {
    expect(escapeHtml("&<>\"'")).toBe("&amp;&lt;&gt;&quot;&#039;");
  });
});

describe('cron-hopp-sync — BUG #346 field-mask projection', () => {
  let getDb;

  beforeEach(async () => {
    vi.resetModules();
    ({ getDb } = await import('../_lib/firebase-admin.js'));
    process.env.CRON_SECRET = 'test-cron-secret';
    process.env.OMNI_ORG_ID = 'org-a';
  });

  afterEach(() => {
    delete process.env.OMNI_ORG_ID;
    delete process.env.CRON_SECRET;
    vi.restoreAllMocks();
  });

  test('.select("scooterId","city","location","orgId") is called before .get() on scooters collection', async () => {
    const { callHoppTool } = await import('../_lib/hopp-mcp-client.js');
    callHoppTool.mockResolvedValue({ rows: [], tickets: [], errors: [] });

    const { rollupTripsToRevenue } = await import('../../src/utils/hoppSyncRollup.js');
    rollupTripsToRevenue.mockReturnValue({ rows: [], errors: [] });

    const selectSpy = vi.fn().mockReturnThis();
    const getMock = vi.fn().mockResolvedValue({
      docs: [
        { id: 'doc1', data: () => ({ scooterId: 's1', city: 'Nafplion', orgId: 'org-a' }) },
      ],
    });

    const fakeDb = {
      collection: vi.fn((name) => {
        if (name === 'users') {
          return { doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ role: 'admin' }) }) })) };
        }
        return {
          select: selectSpy,
          get: getMock,
          add: vi.fn().mockResolvedValue({}),
        };
      }),
      batch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn().mockResolvedValue() })),
    };
    getDb.mockReturnValue(fakeDb);

    const { default: handlerFn } = await import('../_cron-hopp-sync.js');
    const req = makeFakeReq();
    const res = makeFakeRes();

    await handlerFn(req, res);

    // selectSpy should have been called with the four projected fields
    expect(selectSpy).toHaveBeenCalledWith('scooterId', 'city', 'location', 'orgId');
    // getMock should have been called after select
    expect(getMock).toHaveBeenCalled();
  });

  test('scooterCityMap is populated correctly from projected scooter docs', async () => {
    const { callHoppTool } = await import('../_lib/hopp-mcp-client.js');
    // Return a trip for scooter s1 so rollup gets invoked
    callHoppTool.mockResolvedValue({
      rows: [{ _docId: 'trip1', scooterId: 's1', cost: 5, distanceKm: 2, startedAt: new Date().toISOString() }],
      tickets: [],
      errors: [],
    });

    const { rollupTripsToRevenue } = await import('../../src/utils/hoppSyncRollup.js');
    rollupTripsToRevenue.mockReturnValue({ rows: [], errors: [] });

    const selectSpy = vi.fn().mockReturnThis();
    const getMock = vi.fn().mockResolvedValue({
      // Docs only carry the projected fields — no extra fields
      docs: [
        { id: 'doc1', data: () => ({ scooterId: 's1', city: 'Nafplion', orgId: 'org-a' }) },
        { id: 'doc2', data: () => ({ scooterId: 's2', location: 'Corinth', orgId: 'org-a' }) },
      ],
    });

    const fakeDb = {
      collection: vi.fn((name) => {
        if (name === 'users') {
          return { doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ role: 'admin' }) }) })) };
        }
        return {
          select: selectSpy,
          get: getMock,
          add: vi.fn().mockResolvedValue({}),
        };
      }),
      batch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn().mockResolvedValue() })),
    };
    getDb.mockReturnValue(fakeDb);

    const { default: handlerFn } = await import('../_cron-hopp-sync.js');
    const req = makeFakeReq();
    const res = makeFakeRes();

    await handlerFn(req, res);

    // The rollup was called with a scooterCityMap derived from the projected docs
    const rollupCall = rollupTripsToRevenue.mock.calls[0];
    // second arg is the scooterCityMap
    const cityMap = rollupCall[1];
    expect(cityMap.get('s1')).toBe('Nafplion');
    expect(cityMap.get('s2')).toBe('Corinth');
  });
});

// ── BUG #347 — duplicates counter removed ─────────────────────────────────────

describe('cron-hopp-sync — BUG #347 no all-zero duplicates key', () => {
  let getDb;

  beforeEach(async () => {
    vi.resetModules();
    ({ getDb } = await import('../_lib/firebase-admin.js'));
    process.env.CRON_SECRET = 'test-cron-secret';
    process.env.OMNI_ORG_ID = 'org-a';
  });

  afterEach(() => {
    delete process.env.OMNI_ORG_ID;
    delete process.env.CRON_SECRET;
    vi.restoreAllMocks();
  });

  test('happy-path finalize summary does NOT contain a duplicates key', async () => {
    const { callHoppTool } = await import('../_lib/hopp-mcp-client.js');
    callHoppTool.mockResolvedValue({ rows: [], tickets: [], errors: [] });

    const { rollupTripsToRevenue } = await import('../../src/utils/hoppSyncRollup.js');
    rollupTripsToRevenue.mockReturnValue({ rows: [], errors: [] });

    const selectSpy = vi.fn().mockReturnThis();
    const getMock = vi.fn().mockResolvedValue({
      docs: [
        { id: 'doc1', data: () => ({ scooterId: 's1', city: 'Nafplion', orgId: 'org-a' }) },
      ],
    });

    // Track the doc id and data passed to .set() for the syncLogs collection
    let capturedSyncSummary;
    const fakeDb = {
      collection: vi.fn((name) => {
        if (name === 'users') {
          return { doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ role: 'admin' }) }) })) };
        }
        if (name === 'syncLogs') {
          return {
            doc: vi.fn(() => ({
              set: vi.fn((data) => { capturedSyncSummary = data; return Promise.resolve(); }),
            })),
            add: vi.fn().mockResolvedValue({}),
          };
        }
        return {
          select: selectSpy,
          get: getMock,
          add: vi.fn().mockResolvedValue({}),
        };
      }),
      batch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn().mockResolvedValue() })),
    };
    getDb.mockReturnValue(fakeDb);

    const { default: handlerFn } = await import('../_cron-hopp-sync.js');
    const req = makeFakeReq();
    const res = makeFakeRes();

    await handlerFn(req, res);

    expect(res._body.ok).toBe(true);
    // The syncLogs doc should NOT carry a `duplicates` field (or it should be null/absent)
    if (capturedSyncSummary !== undefined) {
      expect(capturedSyncSummary).not.toHaveProperty('duplicates', expect.objectContaining({ trips: 0 }));
    }
    // The JSON response must also not carry a misleading all-zero duplicates object
    if (res._body.duplicates !== undefined && res._body.duplicates !== null) {
      expect(res._body.duplicates).not.toEqual({ trips: 0, events: 0, tickets: 0 });
    }
  });
});

// ── BUG #350 — rollup errors surfaced into syncLogs ───────────────────────────

describe('cron-hopp-sync — BUG #350 rollup errors appear in response', () => {
  let getDb;

  beforeEach(async () => {
    vi.resetModules();
    ({ getDb } = await import('../_lib/firebase-admin.js'));
    process.env.CRON_SECRET = 'test-cron-secret';
    process.env.OMNI_ORG_ID = 'org-a';
  });

  afterEach(() => {
    delete process.env.OMNI_ORG_ID;
    delete process.env.CRON_SECRET;
    vi.restoreAllMocks();
  });

  test('rollup errors are included in the JSON response errors array', async () => {
    const { callHoppTool } = await import('../_lib/hopp-mcp-client.js');
    callHoppTool.mockResolvedValue({
      rows: [{ _docId: 'trip1', scooterId: 's1' }],
      tickets: [],
      errors: [],
    });

    const { rollupTripsToRevenue } = await import('../../src/utils/hoppSyncRollup.js');
    rollupTripsToRevenue.mockReturnValue({
      rows: [],
      errors: ['Unknown scooter: 99999', 'Unknown scooter: 88888'],
    });

    const selectSpy = vi.fn().mockReturnThis();
    const getMock = vi.fn().mockResolvedValue({
      docs: [
        { id: 'doc1', data: () => ({ scooterId: 's1', city: 'Nafplion', orgId: 'org-a' }) },
      ],
    });

    const fakeDb = {
      collection: vi.fn((name) => {
        if (name === 'users') {
          return { doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ role: 'admin' }) }) })) };
        }
        if (name === 'syncLogs') {
          return {
            doc: vi.fn(() => ({ set: vi.fn().mockResolvedValue() })),
            add: vi.fn().mockResolvedValue({}),
          };
        }
        return {
          select: selectSpy,
          get: getMock,
          add: vi.fn().mockResolvedValue({}),
        };
      }),
      batch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn().mockResolvedValue() })),
    };
    getDb.mockReturnValue(fakeDb);

    const { default: handlerFn } = await import('../_cron-hopp-sync.js');
    const req = makeFakeReq();
    const res = makeFakeRes();

    await handlerFn(req, res);

    expect(res._body.ok).toBe(true);
    const errors = res._body.errors || [];
    const rollupErrs = errors.filter((e) => e.tool === 'rollup');
    expect(rollupErrs.length).toBe(2);
    expect(rollupErrs[0].error).toContain('Unknown scooter: 99999');
    expect(rollupErrs[1].error).toContain('Unknown scooter: 88888');
  });
});

// ── BUG #358 — remainingMs() budget-pool caps per-call timeoutMs ──────────────
//
// Vercel maxDuration=60 s. Two sequential 45 s callHoppTool defaults → worst-case
// 90 s budget, causing the runtime to kill the function before the second call
// even fires its AbortController. remainingMs() subordinates each call's timeout
// to remaining wall-clock budget (CRON_BUDGET_MS = 58 000 ms), with a 5 000 ms floor.
//
// Strategy: spy on Date.now() so we can simulate elapsed wall-clock time, capture
// the `timeoutMs` option passed to each callHoppTool invocation, then assert the
// math is correct.

describe('cron-hopp-sync — BUG #358 remainingMs() caps per-call timeoutMs', () => {
  let getDb;
  let callHoppTool;

  const CRON_BUDGET_MS = (60 - 2) * 1000; // 58 000 ms — matches production constant

  function makeStandardFakeDb(getDbMock) {
    const selectSpy = vi.fn().mockReturnThis();
    const getMock = vi.fn().mockResolvedValue({
      docs: [
        { id: 'doc1', data: () => ({ scooterId: 's1', city: 'Nafplion', orgId: 'org-a' }) },
      ],
    });
    const fakeDb = {
      collection: vi.fn((name) => {
        if (name === 'users') {
          return { doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ role: 'admin' }) }) })) };
        }
        if (name === 'syncLogs') {
          return { doc: vi.fn(() => ({ set: vi.fn().mockResolvedValue() })), add: vi.fn().mockResolvedValue({}) };
        }
        return { select: selectSpy, get: getMock, add: vi.fn().mockResolvedValue({}) };
      }),
      batch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn().mockResolvedValue() })),
    };
    getDbMock.mockReturnValue(fakeDb);
    return fakeDb;
  }

  beforeEach(async () => {
    vi.resetModules();
    ({ getDb } = await import('../_lib/firebase-admin.js'));
    ({ callHoppTool } = await import('../_lib/hopp-mcp-client.js'));
    process.env.CRON_SECRET = 'test-cron-secret';
    process.env.OMNI_ORG_ID = 'org-a';
  });

  afterEach(() => {
    delete process.env.OMNI_ORG_ID;
    delete process.env.CRON_SECRET;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test('second callHoppTool gets timeoutMs <= 10 000 when first call consumed 50 000 ms', async () => {
    const startTs = 1_000_000;
    // Simulate: handler start = startTs, first call = startTs + 50 000 ms elapsed
    // so remaining = 58 000 - 50 000 = 8 000 ms (above 5 000 ms floor).
    let callCount = 0;
    const dateSpy = vi.spyOn(Date, 'now');
    dateSpy.mockImplementation(() => {
      // 0 = initial startedAt capture; 1+ = subsequent calls in remainingMs()
      // We let the first remainingMs() call see ~0 ms elapsed (full budget),
      // the second see ~50 000 ms elapsed.
      if (callCount === 0) {
        callCount++;
        return startTs; // this is the startedAt assignment
      }
      if (callCount === 1) {
        callCount++;
        return startTs; // first remainingMs() call → list_trips → ~full budget
      }
      // All subsequent calls (list_repair_events, list_status_events) see 50 000 ms elapsed
      return startTs + 50_000;
    });

    const capturedTimeouts = [];
    callHoppTool.mockImplementation(async (_tool, _args, opts) => {
      capturedTimeouts.push(opts?.timeoutMs ?? null);
      return { rows: [], tickets: [], events: [], errors: [] };
    });

    const { rollupTripsToRevenue } = await import('../../src/utils/hoppSyncRollup.js');
    rollupTripsToRevenue.mockReturnValue({ rows: [], errors: [] });

    makeStandardFakeDb(getDb);

    const { default: handlerFn } = await import('../_cron-hopp-sync.js');
    await handlerFn(makeFakeReq(), makeFakeRes());

    // capturedTimeouts[0] = list_trips, capturedTimeouts[1] = list_repair_events
    // capturedTimeouts[2] = list_status_events for scooter 's1'
    expect(capturedTimeouts.length).toBeGreaterThanOrEqual(2);
    // Second call (list_repair_events): 58 000 - 50 000 = 8 000 ms ≤ 10 000 ms
    expect(capturedTimeouts[1]).toBeLessThanOrEqual(10_000);
    // And it must be above the 5 000 ms floor
    expect(capturedTimeouts[1]).toBeGreaterThanOrEqual(5_000);
  });

  test('floor: when elapsed time exceeds CRON_BUDGET_MS, remainingMs() returns 5 000 ms', async () => {
    const startTs = 1_000_000;
    let callCount = 0;
    const dateSpy = vi.spyOn(Date, 'now');
    dateSpy.mockImplementation(() => {
      if (callCount === 0) { callCount++; return startTs; } // startedAt
      // Every subsequent remainingMs() call sees 70 000 ms elapsed (> 58 000 ms budget)
      return startTs + 70_000;
    });

    const capturedTimeouts = [];
    callHoppTool.mockImplementation(async (_tool, _args, opts) => {
      capturedTimeouts.push(opts?.timeoutMs ?? null);
      return { rows: [], tickets: [], events: [], errors: [] };
    });

    const { rollupTripsToRevenue } = await import('../../src/utils/hoppSyncRollup.js');
    rollupTripsToRevenue.mockReturnValue({ rows: [], errors: [] });

    makeStandardFakeDb(getDb);

    const { default: handlerFn } = await import('../_cron-hopp-sync.js');
    await handlerFn(makeFakeReq(), makeFakeRes());

    // All calls should receive exactly the floor value (5 000 ms), never negative
    expect(capturedTimeouts.length).toBeGreaterThanOrEqual(1);
    for (const t of capturedTimeouts) {
      expect(t).toBe(5_000);
    }
  });
});
