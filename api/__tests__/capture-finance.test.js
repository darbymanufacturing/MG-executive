/**
 * api/__tests__/capture-finance.test.js
 *
 *   capture-classify (#697) — the Capture box's text mode is really read by a
 *     model now; whatever the model says, only the app's own issue fields survive
 *   cron-finance — recurring bills + salary accruals land in Review, held
 *
 * Run with:  npx vitest run api/__tests__/capture-finance.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../_lib/require-auth.js', async () => ({
  ...(await vi.importActual('../_lib/require-auth.js')),
  requireUser: vi.fn(async () => ({ uid: 'u1', role: 'owner', orgId: 'org1' })),
  requireCronOrUser: vi.fn(async () => ({ trigger: 'cron' })),
}));
vi.mock('../_lib/heartbeat.js', () => ({ heartbeatOk: vi.fn(async () => true), heartbeatFail: vi.fn(async () => true) }));

const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { constructor() { this.messages = { create: (...a) => create(...a) }; } },
}));

const ingestBatch = vi.fn(async (raws) => ({ seen: raws.length, auto: 0, held: raws.length, merged: 0, settled: 0, alreadyDecided: 0, errors: [] }));
vi.mock('../_lib/intake-store.js', () => ({
  intakeOrgId: () => 'org1',
  ingestBatch: (...a) => ingestBatch(...a),
  loadCosts: async () => ([
    { id: 'a', name: 'Vodafone', amount: 40, startDate: '2026-06-05', frequency: 'one-time', category: 'SW subscriptions, Telco charges' },
    { id: 'b', name: 'Vodafone', amount: 40, startDate: '2026-07-05', frequency: 'one-time', category: 'SW subscriptions, Telco charges' },
    { id: 'c', name: 'Vodafone', amount: 40, startDate: '2026-08-05', frequency: 'one-time', category: 'SW subscriptions, Telco charges' },
  ]),
  loadOwners: async () => ([{ _docId: 'u1', displayName: 'Kostas M' }]),
}));
vi.mock('../_lib/supabase-admin.js', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { data: { ownerSalaries: { u1: 1500 } } } }) }) }) }),
  }),
}));

const { default: classify, sanitizeClassification } = await import('../_capture-classify.js');
const { default: finance } = await import('../_cron-finance.js');
const { requireCronOrUser } = await import('../_lib/require-auth.js');

const res = () => {
  const r = { statusCode: null, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

beforeEach(() => {
  create.mockReset();
  ingestBatch.mockClear();
  process.env.ANTHROPIC_KEY = 'test';
});

describe('capture-classify', () => {
  it('returns the classified issue fields', async () => {
    create.mockResolvedValue({ content: [{ text: '{"title":"Parking permit for Nafplion","type":"municipality","urgency":"high","nextAction":"Call the town hall","contact":"Dimos Nafpliou"}' }] });
    const r = res();
    await classify({ method: 'POST', body: { text: 'need the parking permit nafplio by friday, call the dimos' } }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ title: 'Parking permit for Nafplion', type: 'municipality', urgency: 'high', nextAction: 'Call the town hall', contact: 'Dimos Nafpliou' });
  });

  it('keeps only answers the app can store, whatever the model says', () => {
    expect(sanitizeClassification({ type: 'hack', urgency: 'critical!!', title: '' }, 'fallback text'))
      .toEqual({ title: 'fallback text', type: 'other', urgency: 'medium', nextAction: '', contact: '' });
  });

  it('is inert without a key, and needs text', async () => {
    delete process.env.ANTHROPIC_KEY;
    const r = res();
    await classify({ method: 'POST', body: { text: 'x' } }, r);
    expect(r.statusCode).toBe(503);
    const r2 = res();
    process.env.ANTHROPIC_KEY = 'test';
    await classify({ method: 'POST', body: {} }, r2);
    expect(r2.statusCode).toBe(400);
  });
});

describe('cron-finance', () => {
  it('suggests the recurring bill and accrues the salary — all through the held queue', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T03:45:00Z'));
    try {
      const r = res();
      await finance({ method: 'GET', query: {} }, r);
      expect(r.statusCode).toBe(200);
      expect(r.body).toMatchObject({ recurringSuggested: 1, salaryAccruals: 1 });
      const [raws, opts] = ingestBatch.mock.calls[0];
      expect(opts).toMatchObject({ source: 'rule', orgId: 'org1' });
      expect(raws.map((x) => x.kind).sort()).toEqual(['ledger', 'recurring']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a manual run from another organization', async () => {
    requireCronOrUser.mockResolvedValueOnce({ trigger: 'manual', uid: 'x', role: 'owner', orgId: 'org2' });
    const r = res();
    await finance({ method: 'GET', query: {} }, r);
    expect(r.statusCode).toBe(403);
    expect(ingestBatch).not.toHaveBeenCalled();
  });
});
