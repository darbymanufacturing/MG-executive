import { describe, test, expect, vi } from 'vitest';

// Mock Firebase and all context modules so the module load succeeds without real credentials.
vi.mock('../../lib/firebase.js', () => ({ db: {}, auth: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
}));
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/OrgContext.jsx', () => ({ useOrg: vi.fn() }));
vi.mock('../../context/CostContext.jsx', () => ({ useCosts: vi.fn() }));
vi.mock('../../context/RevenueContext.jsx', () => ({ useRevenue: vi.fn() }));
vi.mock('../../context/IssueContext.jsx', () => ({ useIssues: vi.fn() }));
vi.mock('../../context/MaintenanceContext.jsx', () => ({ useMaintenance: vi.fn() }));
vi.mock('../../context/ProjectContext.jsx', () => ({ useProjects: vi.fn() }));
vi.mock('../../utils/orgDocId.js', () => ({ orgDocId: vi.fn((a, b) => `${a}_${b}`) }));
vi.mock('../../utils/apiClient.js', () => ({ authedFetch: vi.fn() }));
vi.mock('./DailyBrief.module.css', () => ({ default: {} }));

import { buildBriefPayload } from './DailyBrief.jsx';

// Fixed "today" for deterministic date arithmetic — 2026-06-01 00:00:00 UTC
const TODAY = new Date('2026-06-01T00:00:00.000Z');
const todayStr = '2026-06-01';

// Helper: build a date string N days before TODAY
function daysAgo(n) {
  return new Date(TODAY.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

/* ── 1. overdueTickets: 2 of 3 tickets qualify (not Completed + daysOpen > 7) ── */
describe('buildBriefPayload — overdueTickets', () => {
  test('returns only non-Completed tickets open > 7 days', () => {
    const tickets = [
      { status: 'Active',    daysOpen: 10, issueDescription: 'Brake worn' },
      { status: 'Backlog',   daysOpen: 9,  title: 'Flat tyre' },
      { status: 'Completed', daysOpen: 15, issueDescription: 'Already fixed' },
      { status: 'Active',    daysOpen: 3,  issueDescription: 'Too new' },
    ];
    const { overdueTickets } = buildBriefPayload(
      { maintenanceCtx: { tickets, scooters: [] }, issueCtx: null, projectCtx: null, revenueCtx: null, costsCtx: null },
      TODAY,
    );
    expect(overdueTickets).toHaveLength(2);
    expect(overdueTickets.map(t => t.issueDescription)).toContain('Brake worn');
    expect(overdueTickets.map(t => t.issueDescription)).toContain('Flat tyre');
  });
});

/* ── 2. inRepair: scooter-status count, not ticket count ── */
describe('buildBriefPayload — inRepair', () => {
  test('counts scooters with status "In Repair", not Active+Backlog tickets', () => {
    const scooters = [
      { id: 's1', status: 'In Repair' },
      { id: 's2', status: 'Active' },
      { id: 's3', status: 'Active' },
    ];
    const tickets = [
      { status: 'Active' },
      { status: 'Active' },
    ];
    const { inRepair, payload } = buildBriefPayload(
      { maintenanceCtx: { scooters, tickets }, issueCtx: null, projectCtx: null, revenueCtx: null, costsCtx: null },
      TODAY,
    );
    expect(inRepair).toBe(1);           // 1 scooter In Repair
    expect(payload.inRepair).toBe(1);   // payload also updated
    // activeTickets is the ticket count (2), separate from inRepair
    expect(payload.activeTickets).toBe(2);
  });
});

/* ── 3. revenueThisWeek / revenuePrevWeek with rows spanning 14 days ── */
describe('buildBriefPayload — weekly revenue windows', () => {
  test('sums revenue into correct 7-day buckets', () => {
    // this week: days 0-6 before today (inclusive of today = day 0)
    // prev week: days 7-13 before today
    const revenueData = [
      { date: daysAgo(0), totalPaidRevenue: 100 },  // today → this week
      { date: daysAgo(3), totalPaidRevenue: 200 },  // 3 days ago → this week
      { date: daysAgo(6), totalPaidRevenue: 50  },  // 6 days ago → this week (boundary)
      { date: daysAgo(7), totalPaidRevenue: 300 },  // 7 days ago → prev week (boundary)
      { date: daysAgo(13), totalPaidRevenue: 150 }, // 13 days ago → prev week (boundary)
      { date: daysAgo(14), totalPaidRevenue: 999 }, // 14 days ago → outside both windows
    ];
    const { revenueThisWeek, revenuePrevWeek } = buildBriefPayload(
      { revenueCtx: { revenueData }, maintenanceCtx: null, issueCtx: null, projectCtx: null, costsCtx: null },
      TODAY,
    );
    expect(revenueThisWeek).toBe(350);  // 100 + 200 + 50
    expect(revenuePrevWeek).toBe(450);  // 300 + 150
  });
});

/* ── 4. completedToday: ticket Completed with dateCompleted === today ── */
describe('buildBriefPayload — completedToday', () => {
  test("counts only tickets completed on today's date", () => {
    const tickets = [
      { status: 'Completed', dateCompleted: todayStr },    // counts
      { status: 'Completed', dateCompleted: daysAgo(1) },  // yesterday, skip
      { status: 'Active',    dateCompleted: todayStr },     // wrong status, skip
    ];
    const { completedToday } = buildBriefPayload(
      { maintenanceCtx: { tickets, scooters: [] }, issueCtx: null, projectCtx: null, revenueCtx: null, costsCtx: null },
      TODAY,
    );
    expect(completedToday).toBe(1);
  });
});

/* ── 5. dataIsVoid guard fires when all key metrics are zero ── */
describe('buildBriefPayload — dataIsVoid', () => {
  test('is true when revenueThisMonth, costsThisMonth, revenueThisWeek, and inRepair are all 0', () => {
    const { dataIsVoid } = buildBriefPayload(
      { maintenanceCtx: { tickets: [], scooters: [] }, issueCtx: null, projectCtx: null, revenueCtx: null, costsCtx: null },
      TODAY,
    );
    expect(dataIsVoid).toBe(true);
  });

  test('is false when any key metric is non-zero', () => {
    const revenueData = [{ date: todayStr, totalPaidRevenue: 100 }];
    const { dataIsVoid } = buildBriefPayload(
      { maintenanceCtx: { tickets: [], scooters: [] }, issueCtx: null, projectCtx: null, revenueCtx: { revenueData }, costsCtx: null },
      TODAY,
    );
    expect(dataIsVoid).toBe(false);
  });
});
