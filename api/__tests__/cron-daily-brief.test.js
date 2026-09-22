/**
 * Regression tests for api/_cron-daily-brief.js — the real 07:00 server brief
 * (Autopilot Phase 4; replaces the stub these tests used to cover).
 *
 * Invariants kept from BUG #408 (manual-trigger guard + idempotency):
 *   (1) a brief that already exists today is KEPT (no overwrite, no model call)
 *   (2) ?force=1 regenerates and overwrites
 *   (3) the cron trigger generates the missing briefs
 *   (4) auth failure stops everything
 * Added for Phase 4:
 *   (5) ONE model call per run for the whole org (cost guard)
 *   (6) an all-zero ("data void") day is not narrated and alerts the heartbeat
 *   (7) the WhatsApp brief goes out only with an approved template configured
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

// Keep the REAL requireOrgMember guard; only the token check is faked.
vi.mock('../_lib/require-auth.js', async () => ({
  ...(await vi.importActual('../_lib/require-auth.js')),
  requireCronOrUser: vi.fn(),
}));

const heartbeatOk = vi.fn(async () => true);
const heartbeatFail = vi.fn(async () => true);
vi.mock('../_lib/heartbeat.js', () => ({
  heartbeatOk: (...a) => heartbeatOk(...a),
  heartbeatFail: (...a) => heartbeatFail(...a),
}));

vi.mock('../_lib/intake-store.js', () => ({ intakeOrgId: () => 'org1' }));

const generateBrief = vi.fn(async () => ({
  narrative: 'All good.', sections: [], generatedAt: '2026-09-23T05:00:00.000Z',
}));
vi.mock('../_daily-brief.js', () => ({ generateBrief: (...a) => generateBrief(...a) }));

const sendTemplate = vi.fn(async () => true);
vi.mock('../_lib/whatsapp.js', () => ({
  sendTemplate: (...a) => sendTemplate(...a),
  briefRecipients: () => ['306912345678'],
}));

/* ── fake Supabase ── */
let tables;
vi.mock('../_lib/supabase-admin.js', () => ({
  supabaseAdmin: () => ({
    from: (table) => ({
      select: () => ({
        eq: async () => ({
          data: (tables[table] || []).map((d) => ({ source_doc_id: d._docId, data: d })),
          error: null,
        }),
      }),
    }),
  }),
}));

/* ── fake Firestore ── */
const existingBriefs = new Set();
const writtenBriefs = [];
vi.mock('../_lib/firebase-admin.js', () => ({
  getDb: () => ({
    collection: () => ({
      doc: (key) => ({
        get: async () => ({ exists: existingBriefs.has(key) }),
        set: async (data) => { writtenBriefs.push({ key, data }); },
      }),
    }),
  }),
}));

const { requireCronOrUser } = await import('../_lib/require-auth.js');
const { default: handler } = await import('../_cron-daily-brief.js');

const res = () => {
  const r = { _status: null, _body: null };
  r.status = (c) => { r._status = c; return r; };
  r.json = (b) => { r._body = b; return r; };
  return r;
};

const today = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  vi.clearAllMocks();
  existingBriefs.clear();
  writtenBriefs.length = 0;
  process.env.ANTHROPIC_KEY = 'test-key';
  delete process.env.WHATSAPP_BRIEF_TEMPLATE;
  requireCronOrUser.mockResolvedValue({ trigger: 'cron' });
  tables = {
    costs: [{ _docId: 'c1', name: 'Rent', amount: 350, frequency: 'monthly', startDate: '2026-01-01', category: 'Space rent' }],
    revenue_days: [{ _docId: 'r1', date: today, totalPaidRevenue: 120, location: 'Corinth' }],
    scooters: [{ _docId: 's1', scooterId: '41735', status: 'In Repair' }],
    maintenance_tickets: [{ _docId: 't1', scooterId: '41735', status: 'Backlog', dateEntered: '2026-09-01' }],
    issues: [],
    projects: [],
    users: [
      { _docId: 'uid-kostas', role: 'owner' },
      { _docId: 'uid-panos', role: 'admin' },
      { _docId: 'uid-crew', role: 'crew' },
    ],
    app_config: [{ _docId: 'org1_fleet', fleetSize: 68 }],
    intake_items: [],
  };
});

describe('cron-daily-brief', () => {
  test('(3) cron trigger writes a brief for every admin/owner, never for crew', async () => {
    const r = res();
    await handler({ method: 'GET', query: {} }, r);
    expect(r._status).toBe(200);
    expect(r._body.ok).toBe(true);
    const keys = writtenBriefs.map((w) => w.key).sort();
    expect(keys).toEqual([`org1_${today}_uid-kostas`, `org1_${today}_uid-panos`]);
    expect(writtenBriefs[0].data.narrative).toBe('All good.');
    expect(writtenBriefs[0].data.source).toBe('cron');
  });

  test('(5) one model call for the whole org', async () => {
    await handler({ method: 'GET', query: {} }, res());
    expect(generateBrief).toHaveBeenCalledTimes(1);
  });

  test('(1) keeps briefs that already exist and skips the model call', async () => {
    existingBriefs.add(`org1_${today}_uid-kostas`);
    existingBriefs.add(`org1_${today}_uid-panos`);
    const r = res();
    await handler({ method: 'POST', query: {} }, r);
    expect(r._body.kept).toBe(2);
    expect(r._body.written).toBe(0);
    expect(generateBrief).not.toHaveBeenCalled();
  });

  test('(2) ?force=1 regenerates and overwrites', async () => {
    existingBriefs.add(`org1_${today}_uid-kostas`);
    requireCronOrUser.mockResolvedValue({ trigger: 'manual', uid: 'uid-kostas', role: 'owner', orgId: 'org1' });
    const r = res();
    await handler({ method: 'POST', query: { force: '1' } }, r);
    expect(generateBrief).toHaveBeenCalledTimes(1);
    expect(r._body.written).toBe(2);
  });

  test('(8) a manual trigger from ANOTHER org is refused — nothing generated or written', async () => {
    requireCronOrUser.mockResolvedValue({ trigger: 'manual', uid: 'uid-other', role: 'owner', orgId: 'org2' });
    const r = res();
    await handler({ method: 'POST', query: { force: '1' } }, r);
    expect(r._status).toBe(403);
    expect(generateBrief).not.toHaveBeenCalled();
    expect(writtenBriefs).toHaveLength(0);
  });

  test('(4) auth failure stops everything', async () => {
    requireCronOrUser.mockImplementation(async (_req, rr) => { rr.status(401).json({ error: 'nope' }); return null; });
    const r = res();
    await handler({ method: 'POST', query: {} }, r);
    expect(r._status).toBe(401);
    expect(generateBrief).not.toHaveBeenCalled();
    expect(writtenBriefs).toHaveLength(0);
  });

  test('(6) an all-zero day is not narrated and alerts', async () => {
    tables.costs = [];
    tables.revenue_days = [];
    tables.scooters = [];
    const r = res();
    await handler({ method: 'GET', query: {} }, r);
    expect(r._body.skipped).toBe('data-void');
    expect(generateBrief).not.toHaveBeenCalled();
    expect(heartbeatFail).toHaveBeenCalled();
  });

  test('(7) WhatsApp brief only with an approved template', async () => {
    await handler({ method: 'GET', query: {} }, res());
    expect(sendTemplate).not.toHaveBeenCalled();

    vi.clearAllMocks();
    writtenBriefs.length = 0;
    process.env.WHATSAPP_BRIEF_TEMPLATE = 'omni_morning_brief';
    const r = res();
    await handler({ method: 'GET', query: {} }, r);
    expect(sendTemplate).toHaveBeenCalledWith('306912345678', 'omni_morning_brief', ['All good.'], 'en');
    expect(r._body.whatsappSent).toBe(1);
  });

  test('passes feed health to the brief (stale revenue, pending approvals)', async () => {
    tables.revenue_days = [{ _docId: 'r1', date: '2026-01-01', totalPaidRevenue: 50 }];
    tables.intake_items = [{ _docId: 'i1', status: 'pending' }, { _docId: 'i2', status: 'approved' }];
    await handler({ method: 'GET', query: {} }, res());
    const payload = generateBrief.mock.calls[0][1];
    expect(payload.feedHealth.pendingReview).toBe(1);
    expect(payload.feedHealth.revenueLastDate).toBe('2026-01-01');
    expect(payload.feedHealth.revenueDaysStale).toBeGreaterThan(3);
  });
});
