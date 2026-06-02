/**
 * Regression tests for BUG #368 — list_status_events re-enabled in cron-hopp-sync.js
 *
 * Guards against future accidental re-disabling of the per-scooter events pull.
 * Three scenarios:
 *   1. Happy path: two scooters each return events → aggregated.events is the flattened union.
 *   2. One scooter's call throws → error is pushed to aggregated.errors; remaining scooters still processed.
 *   3. City is injected on each event from scooterCityMap.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock state shared across the whole module import ──────────────────────────

vi.mock('../_lib/firebase-admin.js', () => ({
  getDb: vi.fn(),
  verifyIdToken: vi.fn(),
  FieldValue: { serverTimestamp: () => '__SERVER_TS__' },
}));

vi.mock('../_lib/hopp-mcp-client.js', () => ({
  callHoppTool: vi.fn(),
}));

vi.mock('../../src/utils/hoppSyncRollup.js', () => ({
  rollupTripsToRevenue: vi.fn().mockReturnValue({ rows: [], errors: [] }),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => null),
}));

vi.mock('../../src/lib/supabaseRowMap.js', () => ({
  toSupabaseRow: vi.fn((table, orgId, docId, data) => ({ ...data, source_doc_id: docId })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFakeRes() {
  return {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body)   { this._body = body;  return this; },
  };
}

function makeFakeReq() {
  return {
    method: 'GET',
    headers: { authorization: 'Bearer test-cron-secret' },
  };
}

/**
 * Build a minimal fakeDb whose scooters collection returns the given scooter rows.
 * The batch helper records every written event doc so tests can inspect them.
 */
function makeFakeDb(scooterDocs) {
  const writtenEvents = [];

  const batchSet = vi.fn((ref, data) => {
    if (ref._collection === 'telemetryEvents') {
      writtenEvents.push({ ref, data });
    }
  });
  const batchCommit = vi.fn().mockResolvedValue(undefined);

  const fakeDb = {
    _writtenEvents: writtenEvents,
    collection: vi.fn((name) => {
      if (name === 'users') {
        return { doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ role: 'admin' }) }) })) };
      }
      if (name === 'scooters') {
        const selectSpy = vi.fn().mockReturnThis();
        const getMock = vi.fn().mockResolvedValue({
          docs: scooterDocs.map((d) => ({
            id: d._docId,
            data: () => {
              const { _docId, ...rest } = d;
              return rest;
            },
          })),
        });
        return { select: selectSpy, get: getMock };
      }
      // telemetryEvents / other collections — just return a doc ref builder
      if (name === 'telemetryEvents') {
        return {
          doc: vi.fn((id) => ({ _collection: 'telemetryEvents', _id: id })),
        };
      }
      // syncLogs
      return {
        doc: vi.fn(() => ({ _collection: name })),
        add: vi.fn().mockResolvedValue({}),
      };
    }),
    batch: vi.fn(() => ({ set: batchSet, commit: batchCommit })),
  };
  return fakeDb;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('cron-hopp-sync — BUG #368 list_status_events per-scooter pull', () => {
  let getDb;
  let callHoppTool;

  beforeEach(async () => {
    vi.resetModules();
    process.env.CRON_SECRET  = 'test-cron-secret';
    process.env.OMNI_ORG_ID  = 'mg-executive-org';

    ({ getDb }        = await import('../_lib/firebase-admin.js'));
    ({ callHoppTool } = await import('../_lib/hopp-mcp-client.js'));
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.OMNI_ORG_ID;
    vi.restoreAllMocks();
  });

  // ── Test 1: two scooters → events are flattened ────────────────────────────
  test('list_status_events returns events for two scooters → aggregated.events is the flattened union', async () => {
    const scooterDocs = [
      { _docId: 'doc-s1', scooterId: 's1', city: 'Nafplion', orgId: 'mg-executive-org' },
      { _docId: 'doc-s2', scooterId: 's2', city: 'Corinth',  orgId: 'mg-executive-org' },
    ];

    const fakeDb = makeFakeDb(scooterDocs);
    getDb.mockReturnValue(fakeDb);

    // Bulk tools return empty; only list_status_events returns events
    callHoppTool.mockImplementation(async (tool, args) => {
      if (tool === 'list_trips')         return { rows: [], errors: [] };
      if (tool === 'list_repair_events') return { tickets: [], errors: [] };
      if (tool === 'list_status_events') {
        if (args.scooterId === 's1') return { events: [{ id: 'e1', type: 'trip_start' }, { id: 'e2', type: 'trip_end' }], errors: [] };
        if (args.scooterId === 's2') return { events: [{ id: 'e3', type: 'rebalance' }], errors: [] };
      }
      return {};
    });

    const { default: handler } = await import('../_cron-hopp-sync.js');
    const res = makeFakeRes();
    await handler(makeFakeReq(), res);

    // The cron writes events via writeBatch(db, telemetryEvents, aggregated.events, ...)
    // We verify by checking the batch.set calls for telemetryEvents
    const batchSetCalls = fakeDb.batch().set.mock.calls;
    const eventIds = batchSetCalls
      .filter(([ref]) => ref._collection === 'telemetryEvents')
      .map(([, data]) => data.id);

    // e1, e2, e3 should all be written
    expect(eventIds).toEqual(expect.arrayContaining(['e1', 'e2', 'e3']));
    expect(eventIds).toHaveLength(3);
  });

  // ── Test 2: one scooter throws → error logged; remaining scooters processed ─
  test('when one scooter call throws, error is pushed to aggregated.errors and remaining scooters are still processed', async () => {
    const scooterDocs = [
      { _docId: 'doc-s1', scooterId: 'ok-scooter',  city: 'Athens',   orgId: 'mg-executive-org' },
      { _docId: 'doc-s2', scooterId: 'bad-scooter', city: 'Nafplion', orgId: 'mg-executive-org' },
      { _docId: 'doc-s3', scooterId: 'ok-scooter2', city: 'Corinth',  orgId: 'mg-executive-org' },
    ];

    const fakeDb = makeFakeDb(scooterDocs);
    getDb.mockReturnValue(fakeDb);

    callHoppTool.mockImplementation(async (tool, args) => {
      if (tool === 'list_trips')         return { rows: [], errors: [] };
      if (tool === 'list_repair_events') return { tickets: [], errors: [] };
      if (tool === 'list_status_events') {
        if (args.scooterId === 'bad-scooter') throw new Error('NOT_AUTHORIZED');
        if (args.scooterId === 'ok-scooter')  return { events: [{ id: 'evt-ok-1', type: 'trip_start' }], errors: [] };
        if (args.scooterId === 'ok-scooter2') return { events: [{ id: 'evt-ok-2', type: 'trip_end' }], errors: [] };
      }
      return {};
    });

    const { default: handler } = await import('../_cron-hopp-sync.js');
    const res = makeFakeRes();
    await handler(makeFakeReq(), res);

    // Response must be ok:true (events are non-fatal)
    expect(res._body.ok).toBe(true);

    // Errors array in the response should contain the bad-scooter failure
    const errors = res._body.errors || [];
    const eventErr = errors.find((e) => e.tool === 'list_status_events' && e.scooterId === 'bad-scooter');
    expect(eventErr).toBeDefined();
    expect(eventErr.error).toContain('NOT_AUTHORIZED');

    // ok-scooter and ok-scooter2 events should still have been collected
    const batchSetCalls = fakeDb.batch().set.mock.calls;
    const eventIds = batchSetCalls
      .filter(([ref]) => ref._collection === 'telemetryEvents')
      .map(([, data]) => data.id);
    expect(eventIds).toEqual(expect.arrayContaining(['evt-ok-1', 'evt-ok-2']));
  });

  // ── Test 3: city is injected from scooterCityMap ───────────────────────────
  test('city is injected on each event from scooterCityMap', async () => {
    const scooterDocs = [
      { _docId: 'doc-s1', scooterId: 'sc-city', city: 'Nafplion', orgId: 'mg-executive-org' },
    ];

    const fakeDb = makeFakeDb(scooterDocs);
    getDb.mockReturnValue(fakeDb);

    callHoppTool.mockImplementation(async (tool, _args) => {
      if (tool === 'list_trips')         return { rows: [], errors: [] };
      if (tool === 'list_repair_events') return { tickets: [], errors: [] };
      if (tool === 'list_status_events') {
        return { events: [{ id: 'city-evt', type: 'trip_start' }], errors: [] };
      }
      return {};
    });

    const { default: handler } = await import('../_cron-hopp-sync.js');
    const res = makeFakeRes();
    await handler(makeFakeReq(), res);

    const batchSetCalls = fakeDb.batch().set.mock.calls;
    const cityEventData = batchSetCalls
      .filter(([ref]) => ref._collection === 'telemetryEvents')
      .map(([, data]) => data)
      .find((d) => d.id === 'city-evt');

    expect(cityEventData).toBeDefined();
    expect(cityEventData.city).toBe('Nafplion');
    expect(cityEventData.scooterId).toBe('sc-city');
  });
});
