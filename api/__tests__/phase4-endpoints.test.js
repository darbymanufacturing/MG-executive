/**
 * api/__tests__/phase4-endpoints.test.js
 *
 *   cron-weather     — fetches every configured SPR city and upserts rows on the
 *                      same deterministic ids the SPR panel uses
 *   accountant-pack  — previews without sending; only sends on an explicit
 *                      send:true; refuses without an accountant address
 *
 * Run with:  npx vitest run api/__tests__/phase4-endpoints.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Keep the REAL requireOrgMember guard; only the token checks are faked.
vi.mock('../_lib/require-auth.js', async () => ({
  ...(await vi.importActual('../_lib/require-auth.js')),
  requireCronOrUser: vi.fn(async () => ({ trigger: 'cron' })),
  requireUser: vi.fn(async () => ({ uid: 'u1', email: 'kostas@example.com', role: 'owner', orgId: 'org1' })),
}));
vi.mock('../_lib/heartbeat.js', () => ({ heartbeatOk: vi.fn(async () => true), heartbeatFail: vi.fn(async () => true) }));
vi.mock('../_lib/intake-store.js', () => ({ intakeOrgId: () => 'org1' }));

const fetchRecentWeather = vi.fn(async () => ([
  { date: '2026-09-20', isRainy: false, totalRainMm: 0, weatherCode: 0, temperature: 24 },
  { date: '2026-09-21', isRainy: true, totalRainMm: 3, weatherCode: 61, temperature: 20 },
]));
vi.mock('../../src/utils/openMeteo.js', () => ({ fetchRecentWeather: (...a) => fetchRecentWeather(...a) }));

const sendEmail = vi.fn(async () => ({ error: null }));
vi.mock('resend', () => ({
  Resend: class { constructor() { this.emails = { send: (...a) => sendEmail(...a) }; } },
}));

/* fake Supabase */
let configRows;
let costRows;
const upserts = [];
const eqCalls = [];
vi.mock('../_lib/supabase-admin.js', () => ({
  supabaseAdmin: () => ({
    from: (table) => ({
      select: () => ({
        eq: (col, val) => {
          eqCalls.push([table, col, val]);
          const rows = table === 'costs'
            ? costRows.map((d) => ({ data: d }))
            : (configRows[val] ? [{ data: configRows[val] }] : []);
          const result = { data: rows, error: null };
          return {
            ...result,
            then: (resolve) => resolve(result),
            maybeSingle: async () => ({ data: rows[0] || null, error: null }),
          };
        },
      }),
      upsert: async (rows) => { upserts.push({ table, rows }); return { error: null }; },
    }),
  }),
}));

const { default: weatherHandler } = await import('../_cron-weather.js');
const { default: packHandler } = await import('../_accountant-pack.js');
const { requireCronOrUser, requireUser } = await import('../_lib/require-auth.js');

const res = () => {
  const r = { statusCode: null, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

beforeEach(() => {
  upserts.length = 0;
  eqCalls.length = 0;
  fetchRecentWeather.mockClear();
  sendEmail.mockClear();
  process.env.RESEND_API_KEY = 'test';
  configRows = {
    org1_spr: { cityCenters: { Corinth: { lat: 37.94, lon: 22.93 }, Nafplion: { lat: 37.57, lon: 22.8 } } },
    org1_fleet: { accountantEmail: 'accountant@example.com' },
  };
  costRows = [
    { name: 'JYSK', amount: 124, vatIncluded: true, vatAmount: 24, frequency: 'one-time', startDate: '2026-08-12' },
  ];
});

describe('cron-weather', () => {
  it('fetches every configured city and upserts on the SPR ids', async () => {
    const r = res();
    await weatherHandler({ method: 'GET', query: {} }, r);
    expect(r.statusCode).toBe(200);
    expect(fetchRecentWeather).toHaveBeenCalledTimes(2);
    expect(r.body.rows).toBe(4);
    const ids = upserts.flatMap((u) => u.rows.map((row) => row.source_doc_id)).sort();
    expect(ids).toContain('org1_2026-09-21_Corinth');
    expect(ids).toContain('org1_2026-09-20_Nafplion');
    expect(upserts[0].table).toBe('spr_weather');
  });

  it('is a clean no-op when SPR has no city centres', async () => {
    configRows.org1_spr = { cityCenters: {} };
    const r = res();
    await weatherHandler({ method: 'GET', query: {} }, r);
    expect(r.body.skipped).toMatch(/no SPR city/);
    expect(fetchRecentWeather).not.toHaveBeenCalled();
  });

  it('refuses a manual run from another organization', async () => {
    requireCronOrUser.mockResolvedValueOnce({ trigger: 'manual', uid: 'u2', role: 'owner', orgId: 'org2' });
    const r = res();
    await weatherHandler({ method: 'GET', query: {} }, r);
    expect(r.statusCode).toBe(403);
    expect(fetchRecentWeather).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(0);
  });
});

describe('accountant-pack', () => {
  it('previews without sending anything', async () => {
    const r = res();
    await packHandler({ method: 'POST', body: { month: '2026-08', send: false } }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ preview: true, count: 1, total: 124, vat: 24, recipient: 'accountant@example.com' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sends only on an explicit send:true, with the CSV attached and the owner in CC', async () => {
    const r = res();
    await packHandler({ method: 'POST', body: { month: '2026-08', send: true } }, r);
    expect(r.statusCode).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0][0];
    expect(mail.to).toEqual(['accountant@example.com']);
    expect(mail.cc).toEqual(['kostas@example.com']);
    expect(mail.attachments[0].filename).toBe('omni-expenses-2026-08.csv');
  });

  it('refuses to send without an accountant address', async () => {
    configRows.org1_fleet = {};
    delete process.env.ACCOUNTANT_EMAIL;
    const r = res();
    await packHandler({ method: 'POST', body: { month: '2026-08', send: true } }, r);
    expect(r.statusCode).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('rejects a malformed month', async () => {
    const r = res();
    await packHandler({ method: 'POST', body: { month: 'August' } }, r);
    expect(r.statusCode).toBe(400);
  });

  it("reads the CALLER's organization, never a configured default", async () => {
    requireUser.mockResolvedValueOnce({ uid: 'u9', email: 'other@example.com', role: 'owner', orgId: 'org2' });
    delete process.env.ACCOUNTANT_EMAIL;
    const r = res();
    await packHandler({ method: 'POST', body: { month: '2026-08', send: false } }, r);
    expect(r.statusCode).toBe(200);
    expect(eqCalls).toContainEqual(['costs', 'org_id', 'org2']);
    expect(eqCalls).toContainEqual(['app_config', 'source_doc_id', 'org2_fleet']);
    expect(eqCalls.some(([, , v]) => String(v).startsWith('org1'))).toBe(false);
    expect(r.body.recipient).toBeNull(); // org1's accountant is never revealed to org2
  });

  it('refuses a session with no organization claim', async () => {
    requireUser.mockResolvedValueOnce({ uid: 'u3', email: 'x@example.com', role: 'owner', orgId: null });
    const r = res();
    await packHandler({ method: 'POST', body: { month: '2026-08', send: true } }, r);
    expect(r.statusCode).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(eqCalls).toHaveLength(0);
  });
});
