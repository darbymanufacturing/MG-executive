/**
 * api/__tests__/cron-maintenance.test.js
 *
 * The daily maintenance autopilot (docs/AUTOMATION_PLAN.md Phase 3):
 *   (1) raises a ticket for each due preventive schedule — once, not every day
 *   (2) reconciles scooter status with open tickets (incl. crew-app completions)
 *   (3) never touches deliberate statuses (Donor / Retired)
 *   (4) reports failures through the heartbeat instead of hiding them
 *
 * Run with:  npx vitest run api/__tests__/cron-maintenance.test.js
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Keep the REAL requireOrgMember guard; only the token check is faked.
vi.mock('../_lib/require-auth.js', async () => ({
  ...(await vi.importActual('../_lib/require-auth.js')),
  requireCronOrUser: vi.fn(async () => ({ trigger: 'cron' })),
}));

const heartbeatOk = vi.fn(async () => true);
const heartbeatFail = vi.fn(async () => true);
vi.mock('../_lib/heartbeat.js', () => ({
  heartbeatOk: (...a) => heartbeatOk(...a),
  heartbeatFail: (...a) => heartbeatFail(...a),
}));

vi.mock('../_lib/intake-store.js', () => ({ intakeOrgId: () => 'org1' }));

/* ── tiny fake Supabase ── */
let db;
const writes = { upserts: [], updates: [] };

function fakeClient() {
  return {
    from(table) {
      return {
        select() {
          return { eq: async () => ({ data: (db[table] || []).map((d) => ({ source_doc_id: d._docId, data: d })), error: null }) };
        },
        async upsert(row) {
          writes.upserts.push({ table, row });
          return { error: null };
        },
        update(patch) {
          return {
            eq: async (_col, id) => {
              writes.updates.push({ table, id, patch });
              return { error: null };
            },
          };
        },
      };
    },
  };
}

vi.mock('../_lib/supabase-admin.js', () => ({ supabaseAdmin: () => fakeClient() }));

const { default: handler } = await import('../_cron-maintenance.js');

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const TODAY = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  writes.upserts.length = 0;
  writes.updates.length = 0;
  heartbeatOk.mockClear();
  heartbeatFail.mockClear();
  db = {
    maintenance_schedules: [
      { _docId: 'org1_s1', scooterId: '41735', title: 'Brake check', nextDue: '2026-01-01', status: 'active' },
      { _docId: 'org1_s2', scooterId: '51946', title: 'Tyre check', nextDue: '2999-01-01', status: 'active' },
    ],
    maintenance_tickets: [
      // crew-app completion: scooter still marked In Repair → should flip Active
      { _docId: 'org1_69549_2026-09-01', scooterId: '69549', status: 'Completed' },
    ],
    scooters: [
      { _docId: 'org1_41735', scooterId: '41735', status: 'Active', city: 'Nafplion' },
      { _docId: 'org1_69549', scooterId: '69549', status: 'In Repair', city: 'Corinth' },
      { _docId: 'org1_18741', scooterId: '18741', status: 'Donor', city: 'Corinth' },
    ],
  };
});

describe('cron-maintenance', () => {
  it('raises a ticket for the due schedule only', async () => {
    const res = mockRes();
    await handler({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ticketsRaised).toBe(1);

    const [{ row }] = writes.upserts.filter((w) => w.table === 'maintenance_tickets');
    expect(row.source_doc_id).toBe(`org1_41735_${TODAY}`);
    expect(row.data.scheduleId).toBe('org1_s1');
    expect(row.data.city).toBe('Nafplion');
    expect(row.data.status).toBe('Backlog');
  });

  it('puts the scooter with the new ticket In Repair and returns the finished one to Active', async () => {
    const res = mockRes();
    await handler({ method: 'GET', query: {} }, res);
    const byId = Object.fromEntries(writes.updates.map((u) => [u.id, u.patch.data.status]));
    expect(byId.org1_41735).toBe('In Repair');
    expect(byId.org1_69549).toBe('Active');
    expect(byId.org1_18741).toBeUndefined(); // Donor is never touched
  });

  it('does not raise the same ticket twice while it is still open', async () => {
    db.maintenance_tickets.push({ _docId: 'org1_41735_x', scooterId: '41735', status: 'Backlog', scheduleId: 'org1_s1' });
    const res = mockRes();
    await handler({ method: 'GET', query: {} }, res);
    expect(res.body.ticketsRaised).toBe(0);
  });

  it('avoids id collisions with an existing ticket on the same scooter and day', async () => {
    db.maintenance_tickets.push({ _docId: `org1_41735_${TODAY}`, scooterId: '41735', status: 'Completed' });
    const res = mockRes();
    await handler({ method: 'GET', query: {} }, res);
    const [{ row }] = writes.upserts.filter((w) => w.table === 'maintenance_tickets');
    expect(row.source_doc_id).toBe(`org1_41735_${TODAY}_2`);
  });

  it('pings the heartbeat on success', async () => {
    await handler({ method: 'GET', query: {} }, mockRes());
    expect(heartbeatOk).toHaveBeenCalledTimes(1);
    expect(heartbeatFail).not.toHaveBeenCalled();
  });

  it('refuses a manual run from another organization and writes nothing', async () => {
    const { requireCronOrUser } = await import('../_lib/require-auth.js');
    requireCronOrUser.mockResolvedValueOnce({ trigger: 'manual', uid: 'u2', role: 'owner', orgId: 'org2' });
    const res = mockRes();
    await handler({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(403);
    expect(writes.upserts).toHaveLength(0);
    expect(writes.updates).toHaveLength(0);
  });
});
