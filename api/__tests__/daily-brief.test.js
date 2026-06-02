/**
 * api/__tests__/daily-brief.test.js
 *
 * Regression tests for bug #344 — daily-brief.js must use the Anthropic SDK
 * tool_use mechanism rather than regex fence-strip + JSON.parse, so that
 * Opus 4.8 preamble/commentary cannot break parsing.
 *
 * Run with:  npx vitest run api/__tests__/daily-brief.test.js
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- Mock require-auth.js — always returns a valid user -------------------
vi.mock('../_lib/require-auth.js', () => ({
  requireUser: vi.fn(async (_req, _res) => ({ uid: 'test-uid', email: 'test@test.com' })),
}));

// --- Mock the Anthropic SDK ------------------------------------------------
// `anthropicResponseMock` is a module-level var so closures in the factory
// always read the current value (set per-test before calling handler).
let anthropicResponseMock;

const createMock = async () => anthropicResponseMock;

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class {
      constructor() {
        this.messages = { create: createMock };
      }
    },
  };
});

// --- Import handler AFTER mocks are in place --------------------------------
import handler from '../_daily-brief.js';

// Minimal req/res helpers
function makeReq(body = {}) {
  return {
    method: 'POST',
    body: {
      userId: 'test-uid',
      date: '2026-06-01',
      data: {
        fleetSize: 50,
        inRepair: 5,
        revenueThisWeek: 3000,
        revenuePrevWeek: 2800,
        costsThisMonth: 12000,
        activeTickets: 8,
        completedToday: 2,
        openIssues: [],
        overdueTickets: [],
        openProjects: [],
        criticalIssues: 0,
      },
      ...body,
    },
    headers: { authorization: 'Bearer fake-token' },
  };
}

function makeRes() {
  const res = {
    _status: null,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
  };
  return res;
}

beforeEach(() => {
  anthropicResponseMock = undefined;
  process.env.ANTHROPIC_KEY = 'test-key';
});

// ---------------------------------------------------------------------------
// Case (a): valid tool_use block → handler returns {narrative, sections, generatedAt}
// ---------------------------------------------------------------------------
describe('bug-344 — valid tool_use block', () => {
  it('returns narrative, sections, and generatedAt when tool_use block is present', async () => {
    anthropicResponseMock = {
      content: [
        {
          type: 'tool_use',
          name: 'daily_brief',
          input: {
            narrative: 'Fleet is running well with 10% offline. Revenue is up 7% week-on-week. No critical issues today.',
            sections: [
              { title: 'Yesterday / Overnight', items: ['2 tickets closed', 'Revenue on track'] },
              { title: 'Needs attention today', items: ['5 scooters in repair — check turnaround'] },
            ],
          },
        },
      ],
    };

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.narrative).toBe(
      'Fleet is running well with 10% offline. Revenue is up 7% week-on-week. No critical issues today.'
    );
    expect(res._body.sections).toHaveLength(2);
    expect(res._body.sections[0].title).toBe('Yesterday / Overnight');
    expect(res._body.generatedAt).toBeTruthy();
    expect(res._body.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Case (b): no tool_use block returned → degraded fallback with error field
// ---------------------------------------------------------------------------
describe('bug-344 — no tool_use block in response', () => {
  it('returns degraded fallback JSON with error: "No tool_use block returned"', async () => {
    // Simulate the model returning only a text block (e.g., with preamble prose)
    anthropicResponseMock = {
      content: [
        {
          type: 'text',
          text: 'Here is the JSON: {"narrative": "...", "sections": []}',
        },
      ],
    };

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.narrative).toMatch(/formatting issue/);
    expect(res._body.sections).toEqual([]);
    expect(res._body.error).toBe('No tool_use block returned');
    expect(res._body.generatedAt).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Case (c): tool_use block with narrative only (sections absent/empty) → graceful defaults
// ---------------------------------------------------------------------------
describe('bug-344 — tool_use block with missing sections field', () => {
  it('returns empty sections array as default when sections is absent from tool input', async () => {
    anthropicResponseMock = {
      content: [
        {
          type: 'tool_use',
          name: 'daily_brief',
          input: {
            narrative: 'Everything looks good today.',
            // sections intentionally absent — tests the `parsed.sections || []` default
          },
        },
      ],
    };

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.narrative).toBe('Everything looks good today.');
    expect(res._body.sections).toEqual([]);
    expect(res._body.generatedAt).toBeTruthy();
  });
});
