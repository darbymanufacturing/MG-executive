/**
 * api/__tests__/mcp.test.js
 *
 * Regression tests for the Omni remote MCP connector (api/_mcp.js, ADR-0029).
 * There was previously no test file for this handler at all — `get_financial_summary`
 * and `get_planner_month` queried a Supabase table named "revenue", which does not
 * exist (the real table is "revenue_days"); both tools would have thrown on first
 * real use. This suite is designed so that regression would have failed it.
 *
 * Covers:
 *   (1) Auth guards: 503 when MCP_SHARED_TOKEN is unset, 401 on a wrong/missing
 *       key, 405 on non-POST, and that both ?key= and Authorization: Bearer work.
 *   (2) Every registered tool has a title and a readOnlyHint/destructiveHint
 *       annotation (Anthropic connector review requirement).
 *   (3) Every tool this suite exercises only ever queries table names that are
 *       real values in SUPABASE_TABLE — the exact regression guard for the
 *       "revenue" vs "revenue_days" bug.
 *   (4) get_financial_summary (month mode) and get_planner_month agree with
 *       each other AND with a direct buildPlannerModel() call on the same
 *       fixtures — proving both tools share one calculation engine instead of
 *       hand-rolled, driftable copies (ADR-0024 spirit).
 *   (5) A smoke test per remaining tool: valid params, no isError, sane shape.
 *
 * Talks to the server over an in-memory MCP transport (no real HTTP), so the
 * tool logic is exercised exactly as a client would call it.
 *
 * Run with:  npx vitest run api/__tests__/mcp.test.js
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SUPABASE_TABLE } from '../../src/lib/supabaseRowMap.js';
import { buildPlannerModel } from '../../src/utils/financialPlanner.js';

const ORG_ID = 'mg-executive-org';
const KNOWN_TABLES = new Set(Object.values(SUPABASE_TABLE));

// ── Fake Supabase service-role client ───────────────────────────────────────

let FIXTURES; // real table name -> [{ org_id, source_doc_id, data }]
let fakeSupa;
let fakeConfig; // returned by the mocked sbGetDoc
const queriedTables = new Set();

function row(sourceDocId, data) {
  return { org_id: ORG_ID, source_doc_id: sourceDocId, data };
}

function makeFakeSupabase() {
  return {
    from(table) {
      queriedTables.add(table);
      return {
        select() {
          return {
            eq(_col, orgId) {
              return {
                range(from, to) {
                  const all = (FIXTURES[table] || []).filter((r) => r.org_id === orgId);
                  return Promise.resolve({ data: all.slice(from, to + 1), error: null });
                },
              };
            },
          };
        },
        insert(newRow) {
          FIXTURES[table] = FIXTURES[table] || [];
          FIXTURES[table].push({ org_id: newRow.org_id, source_doc_id: newRow.source_doc_id, data: newRow.data });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

vi.mock('../_lib/supabase-admin.js', () => ({
  supabaseAdmin: vi.fn(() => fakeSupa),
  sbGetDoc: vi.fn(async () => fakeConfig),
}));

// Import AFTER the mock — same convention as cloudinary-sign.test.js.
import mcpHandler, { buildServer } from '../_mcp.js';

beforeEach(() => {
  queriedTables.clear();
  fakeConfig = null;
  delete process.env.MCP_SHARED_TOKEN;
  process.env.MCP_ORG_ID = ORG_ID;

  FIXTURES = {
    [SUPABASE_TABLE.costs]: [
      row('c1', { id: 'c1', name: 'Office rent', amount: 500, category: 'Space rent', frequency: 'monthly', startDate: '2020-01-01' }),
      row('c2', { id: 'c2', name: 'Fuel run', amount: 40, category: 'Fuel', frequency: 'one-time', startDate: '2026-06-10' }),
      row('c3', { id: 'c3', name: 'Owner draw', amount: 200, category: 'CEO', frequency: 'one-time', startDate: '2026-06-15' }),
      row('c4', { id: 'c4', name: 'Internal move', amount: 75, category: 'Transfer, withdraw', frequency: 'one-time', startDate: '2026-06-20' }),
      row('c5', { id: 'c5', name: 'Bank fee', amount: 12, category: 'Bank Fees', frequency: 'one-time', startDate: '2026-06-05', source: 'alphabank-csv' }),
    ],
    [SUPABASE_TABLE.revenue]: [
      row('r1', { date: '2026-06-01', city: 'Nafplion', totalPaidRevenue: 300, tripCount: 40, uniqueVehiclesCount: 10 }),
      row('r2', { date: '2026-06-02', city: 'Corinth', totalPaidRevenue: 150, tripCount: 20, uniqueVehiclesCount: 6 }),
    ],
    [SUPABASE_TABLE.scooters]: [
      row('s1', { id: 'SC-1', model: 'Ninebot', city: 'Nafplion', status: 'Active', purchaseDate: '2025-01-01', purchasePrice: 400 }),
      row('s2', { id: 'SC-2', model: 'Ninebot', city: 'Corinth', status: 'In Repair', purchaseDate: '2025-02-01', purchasePrice: 420 }),
    ],
    [SUPABASE_TABLE.maintenanceTickets]: [
      row('t1', { id: 'T1', scooterId: 'SC-2', category: 'Brakes', status: 'Active', dateEntered: '2026-06-03', labourMinutes: 45, partsUsed: ['pad'] }),
    ],
    [SUPABASE_TABLE.issues]: [
      row('i1', { title: 'App crash on login', description: 'reported by staff', status: 'new', urgency: 'high', owner: 'kostas', createdAt: '2026-06-04T10:00:00Z' }),
    ],
    [SUPABASE_TABLE.projects]: [
      row('p1', {
        name: 'Corfu launch', owner: 'Kostas', type: 'Growth', category: 'Expansion', health: 'onTrack',
        startDate: '2026-01-01', targetDate: '2026-12-01', archived: false,
        phases: [{ id: 'ph1', done: true, tasks: [{ id: 'tk1', done: true }, { id: 'tk2', done: false }] }],
        blockers: [{ id: 'b1' }],
      }),
    ],
    [SUPABASE_TABLE.loans]: [
      row('l1', { loanNumber: 'LN-1', name: 'Alpha Bank term loan', currentBalance: 5000, interestRate: 0.06, monthlyPayment: 250, entries: [{ date: '2026-06-01' }] }),
    ],
    [SUPABASE_TABLE.ownerLedger]: [
      row('ol1', { ownerUid: 'kostas-uid', ownerName: 'Kostas', type: 'capital_injection', amount: 1000, date: '2026-01-01' }),
      row('ol2', { ownerUid: 'kostas-uid', ownerName: 'Kostas', type: 'drawing', amount: 300, date: '2026-06-01' }),
    ],
  };
  fakeSupa = makeFakeSupabase();
});

function toRecords(table) {
  return (FIXTURES[table] || []).map((r) => ({ _docId: r.source_doc_id, ...r.data }));
}

// ── HTTP-layer guards (no transport involved — these return before it) ─────

function makeReq({ method = 'POST', headers = {}, body = {}, url = '/api/mcp' } = {}) {
  return { method, headers, body, url };
}
function makeRes() {
  return {
    _status: null,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
  };
}

describe('mcpHandler — auth + method guards', () => {
  it('503 when MCP_SHARED_TOKEN is unset (safe default)', async () => {
    const res = makeRes();
    await mcpHandler(makeReq(), res);
    expect(res._status).toBe(503);
  });

  it('401 when the key is missing', async () => {
    process.env.MCP_SHARED_TOKEN = 'correct-token-value';
    const res = makeRes();
    await mcpHandler(makeReq(), res);
    expect(res._status).toBe(401);
  });

  it('401 when the key is wrong, even at the same length (constant-time compare)', async () => {
    process.env.MCP_SHARED_TOKEN = 'abcdefghij';
    const res = makeRes();
    await mcpHandler(makeReq({ url: '/api/mcp?key=zzzzzzzzzz' }), res);
    expect(res._status).toBe(401);
  });

  it('accepts a valid ?key= query param', async () => {
    process.env.MCP_SHARED_TOKEN = 'correct-token-value';
    const res = makeRes();
    await mcpHandler(makeReq({ method: 'GET', url: '/api/mcp?key=correct-token-value' }), res);
    // GET is rejected with 405, not 401 — proves the key itself was accepted.
    expect(res._status).toBe(405);
  });

  it('accepts a valid Authorization: Bearer header', async () => {
    process.env.MCP_SHARED_TOKEN = 'correct-token-value';
    const res = makeRes();
    await mcpHandler(makeReq({ method: 'GET', headers: { authorization: 'Bearer correct-token-value' } }), res);
    expect(res._status).toBe(405);
  });

  it('405 on GET with a valid key (stateless server — POST JSON-RPC only)', async () => {
    process.env.MCP_SHARED_TOKEN = 'correct-token-value';
    const res = makeRes();
    await mcpHandler(makeReq({ method: 'GET', url: '/api/mcp?key=correct-token-value' }), res);
    expect(res._status).toBe(405);
  });
});

// ── Tool-layer tests, over an in-memory MCP transport ───────────────────────

async function connectedClient() {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

function payload(result) {
  expect(result.isError, `expected success, got isError with: ${result.content?.[0]?.text}`).toBeFalsy();
  return JSON.parse(result.content[0].text);
}

describe('tool catalog', () => {
  it('registers all 17 tools, each with a title and a readOnly/destructive hint', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.length).toBe(17);
    tools.forEach((t) => {
      expect(t.title, `${t.name} is missing a title`).toBeTruthy();
      const hasHint = t.annotations?.readOnlyHint === true || t.annotations?.destructiveHint !== undefined;
      expect(hasHint, `${t.name} is missing readOnlyHint/destructiveHint`).toBe(true);
    });
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain('add_cost');
    expect(names).toContain('get_fleet_summary');
    expect(names).toContain('list_scooters');
    expect(names).toContain('get_maintenance_summary');
    expect(names).toContain('list_maintenance_tickets');
    expect(names).toContain('list_issues');
    expect(names).toContain('list_projects');
    expect(names).toContain('get_owner_ledger');
    expect(names).toContain('list_revenue_days');
  });
});

describe('table-name regression guard (the "revenue" vs "revenue_days" bug)', () => {
  it('every table queried while exercising all read tools is a real SUPABASE_TABLE value', async () => {
    const client = await connectedClient();
    const READ_CALLS = [
      ['get_financial_summary', { month: '2026-06' }],
      ['list_costs', {}],
      ['list_recurring', {}],
      ['get_planner_month', { month: '2026-06' }],
      ['get_bank_import_status', {}],
      ['list_loans', {}],
      ['get_owner_ledger', {}],
      ['list_revenue_days', { month: '2026-06' }],
      ['get_fleet_summary', {}],
      ['list_scooters', {}],
      ['get_maintenance_summary', {}],
      ['list_maintenance_tickets', {}],
      ['list_issues', {}],
      ['list_projects', {}],
      ['search', { query: 'fuel' }],
    ];
    for (const [name, args] of READ_CALLS) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, `${name} returned isError: ${result.content?.[0]?.text}`).toBeFalsy();
    }
    expect(queriedTables.size).toBeGreaterThan(0);
    queriedTables.forEach((t) => {
      expect(KNOWN_TABLES.has(t), `queried unknown table "${t}" — not in SUPABASE_TABLE`).toBe(true);
    });
    // The specific regression: the literal string "revenue" must never be queried.
    expect(queriedTables.has('revenue')).toBe(false);
    expect(queriedTables.has(SUPABASE_TABLE.revenue)).toBe(true);
  });
});

describe('get_financial_summary + get_planner_month share one engine', () => {
  it('agree with each other and with a direct buildPlannerModel() call on the same data', async () => {
    const client = await connectedClient();

    const [summaryResult, plannerResult] = await Promise.all([
      client.callTool({ name: 'get_financial_summary', arguments: { month: '2026-06' } }),
      client.callTool({ name: 'get_planner_month', arguments: { month: '2026-06' } }),
    ]);
    const summary = payload(summaryResult);
    const planner = payload(plannerResult);

    const expected = buildPlannerModel({
      costs: toRecords(SUPABASE_TABLE.costs),
      revenue: toRecords(SUPABASE_TABLE.revenue),
      year: 2026,
      openingBalance: 0,
    }).months.find((m) => m.key === '2026-06').summary;

    expect(planner.totals).toEqual(expected);
    expect(summary.revenue_ex_vat).toBe(expected.revenue);
    expect(summary.cash_costs).toBe(expected.expenses);
    expect(summary.net_cash_flow).toBe(expected.netCashFlow);
    expect(summary.dividends_owner_draw).toBe(expected.dividends);

    // The one-time "Transfer, withdraw" row is reported as an informational
    // extra by get_financial_summary; buildPlannerModel drops it silently.
    expect(summary.internal_transfers_excluded).toBe(75);
  });

  it('get_financial_summary all-time mode sums every one-time row (no month arg)', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'get_financial_summary', arguments: {} });
    const body = payload(result);
    expect(body.period).toBe('all-time');
    // Fuel(40) + Bank fee(12) — CEO/Transfer/recurring rent are excluded from "spent".
    expect(body.cash_costs).toBe(52);
    expect(body.revenue_ex_vat).toBe(450);
    expect(body.dividends_owner_draw).toBe(200);
    expect(body.internal_transfers_excluded).toBe(75);
  });

  it('rejects a malformed month', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'get_financial_summary', arguments: { month: '2026/06' } });
    expect(result.isError).toBe(true);
  });
});

describe('individual tool smoke tests', () => {
  it('list_costs filters by free-text query', async () => {
    const client = await connectedClient();
    const body = payload(await client.callTool({ name: 'list_costs', arguments: { query: 'fuel' } }));
    expect(body.count).toBe(1);
    expect(body.costs[0].name).toBe('Fuel run');
  });

  it('list_recurring reports the monthly rent as a run-rate commitment', async () => {
    const client = await connectedClient();
    const body = payload(await client.callTool({ name: 'list_recurring', arguments: {} }));
    expect(body.commitments.some((c) => c.name === 'Office rent')).toBe(true);
    expect(body.monthly_run_rate).toBeGreaterThanOrEqual(500);
  });

  it('get_bank_import_status reflects the one alphabank-csv row', async () => {
    const client = await connectedClient();
    const body = payload(await client.callTool({ name: 'get_bank_import_status', arguments: {} }));
    expect(body.imported).toBe(1);
    expect(body.latest_transaction).toBe('2026-06-05');
    expect(body.next_export_from).toBe('2026-06-06');
  });

  it('list_loans totals the outstanding balance', async () => {
    const client = await connectedClient();
    const body = payload(await client.callTool({ name: 'list_loans', arguments: {} }));
    expect(body.count).toBe(1);
    expect(body.total_outstanding).toBe(5000);
  });

  it('get_owner_ledger nets capital in vs drawings out per owner', async () => {
    const client = await connectedClient();
    const body = payload(await client.callTool({ name: 'get_owner_ledger', arguments: {} }));
    expect(body.owners).toHaveLength(1);
    expect(body.owners[0].balance).toBe(700); // +1000 capital_injection, -300 drawing
  });

  it('list_revenue_days filters by month and sorts newest first', async () => {
    const client = await connectedClient();
    const body = payload(await client.callTool({ name: 'list_revenue_days', arguments: { month: '2026-06' } }));
    expect(body.count).toBe(2);
    expect(body.revenue_days[0].date).toBe('2026-06-02');
  });

  it('get_fleet_summary counts by status and city, and sums capital deployed', async () => {
    const client = await connectedClient();
    const body = payload(await client.callTool({ name: 'get_fleet_summary', arguments: {} }));
    expect(body.total).toBe(2);
    expect(body.active).toBe(1);
    expect(body.by_status['In Repair']).toBe(1);
    expect(body.capital_deployed).toBe(820);
  });

  it('list_scooters filters by status', async () => {
    const client = await connectedClient();
    const body = payload(await client.callTool({ name: 'list_scooters', arguments: { status: 'Active' } }));
    expect(body.count).toBe(1);
    expect(body.scooters[0].id).toBe('SC-1');
  });

  it('get_maintenance_summary aggregates labour minutes and top categories', async () => {
    const client = await connectedClient();
    const body = payload(await client.callTool({ name: 'get_maintenance_summary', arguments: {} }));
    expect(body.total).toBe(1);
    expect(body.labour_minutes_logged).toBe(45);
    expect(body.top_categories[0]).toEqual({ category: 'Brakes', count: 1 });
  });

  it('list_maintenance_tickets filters by scooterId', async () => {
    const client = await connectedClient();
    const body = payload(await client.callTool({ name: 'list_maintenance_tickets', arguments: { scooterId: 'SC-2' } }));
    expect(body.count).toBe(1);
    expect(body.tickets[0].parts_used).toBe(1);
  });

  it('list_issues filters by urgency', async () => {
    const client = await connectedClient();
    const body = payload(await client.callTool({ name: 'list_issues', arguments: { urgency: 'high' } }));
    expect(body.count).toBe(1);
    expect(body.issues[0].title).toBe('App crash on login');
  });

  it('list_projects reports phase/task progress and excludes archived by default', async () => {
    const client = await connectedClient();
    const body = payload(await client.callTool({ name: 'list_projects', arguments: {} }));
    expect(body.count).toBe(1);
    expect(body.projects[0]).toMatchObject({
      name: 'Corfu launch', health: 'onTrack', phases_total: 1, phases_done: 1,
      tasks_total: 2, tasks_done: 1, blockers_open: 1,
    });
  });

  it('search finds records across kinds and fetch resolves them back', async () => {
    const client = await connectedClient();
    const searchBody = payload(await client.callTool({ name: 'search', arguments: { query: 'corfu' } }));
    expect(searchBody.results.some((r) => r.id === 'project:p1')).toBe(true);

    const fetchBody = payload(await client.callTool({ name: 'fetch', arguments: { id: 'project:p1' } }));
    expect(fetchBody.record.name).toBe('Corfu launch');
  });

  it('fetch returns an error result for an unknown id kind', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'fetch', arguments: { id: 'bogus:xyz' } });
    expect(result.isError).toBe(true);
  });

  it('add_cost inserts a new one-time cost row tagged source: mcp', async () => {
    const client = await connectedClient();
    const body = payload(await client.callTool({
      name: 'add_cost',
      arguments: { name: 'Test expense', amount: 19.99, category: 'Fuel', date: '2026-06-25' },
    }));
    expect(body.ok).toBe(true);
    expect(body.created.amount).toBe(19.99);

    const inserted = FIXTURES[SUPABASE_TABLE.costs].find((r) => r.source_doc_id === `${ORG_ID}_mcp_2026-06-25_${body.created.id.slice(0, 8)}`);
    expect(inserted).toBeTruthy();
    expect(inserted.data.source).toBe('mcp');
    expect(inserted.data.createdByUid).toBe('mcp-connector');
  });
});
