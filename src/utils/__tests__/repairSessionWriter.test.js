/**
 * repairSessionWriter — regression tests for:
 *   BUG-420: orgId never stamped on repairSessions (ADR-0003 violation)
 *   BUG-422: concurrent technicians can double-complete a ticket
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- Firebase mock ---------------------------------------------------------
// runTransaction captures the callback so we can inspect what it passes.
let _transactionCallback = null;
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, col, id) => ({ __ref: 'doc', col, id })),
  increment: vi.fn((n) => ({ __increment: n })),
  arrayUnion: vi.fn((...args) => ({ __arrayUnion: args })),
  serverTimestamp: vi.fn(() => '__SERVER_TS__'),
  runTransaction: vi.fn(async (_db, cb) => {
    _transactionCallback = cb;
    return cb(_mockTransaction);
  }),
}));

vi.mock('../../lib/firebase.js', () => ({
  db: { __db: true },
}));

// --- orgWrite hook mock ----------------------------------------------------
let _activeOrg = null;
vi.mock('../../hooks/orgWrite.js', () => ({
  getActiveOrg: vi.fn(() => _activeOrg),
}));

// --- Shared transaction mock -----------------------------------------------
// We build this per-test so we can control ticket snap state.
let _mockTransaction;

function buildMockTransaction({
  ticketStatus = 'In Progress',
  ticketCompletedBy = null,
  partUnitCost = 5,
} = {}) {
  return {
    get: vi.fn(async (ref) => {
      if (ref.col === 'maintenanceTickets') {
        return {
          exists: () => true,
          data: () => ({ status: ticketStatus, completedBy: ticketCompletedBy }),
        };
      }
      // Part docs — always sufficient stock; expose unitCost for BUG-445 tests
      return {
        exists: () => true,
        ref,
        data: () => ({ stockOnHand: 99, unitCost: partUnitCost }),
      };
    }),
    update: vi.fn(),
    set: vi.fn(),
  };
}

// --- Minimal valid call args -----------------------------------------------
const START = new Date('2026-06-01T10:00:00.000Z');
const END   = new Date('2026-06-01T11:00:00.000Z');

const VALID_ARGS = {
  ticketDocId:    'ticket-1',
  sessionId:      'session-abc',
  procedureId:    'proc-1',
  scooterId:      'scooter-42',
  technicianUid:  'tech-uid',
  technicianName: 'Alice',
  startedAt:      START,
  completedAt:    END,
  steps: [
    {
      stepNumber: 1,
      notes: 'Replaced brake pads',
      partsUsed: [{ partId: 'part-1', partName: 'Brake Pad', quantity: 2, unitCost: 5 }],
      photoUrls: [],
    },
  ],
};

import { completeRepairSession } from '../repairSessionWriter.js';

// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  _activeOrg = 'org-xyz';
  _mockTransaction = buildMockTransaction({ ticketStatus: 'In Progress' });
});

// ---------------------------------------------------------------------------
// BUG-420: orgId guard + stamp
// ---------------------------------------------------------------------------
describe('BUG-420 — ADR-0003 orgId guard', () => {
  it('throws immediately when getActiveOrg() returns null, before runTransaction', async () => {
    _activeOrg = null;
    const { runTransaction } = await import('firebase/firestore');
    await expect(completeRepairSession(VALID_ARGS)).rejects.toThrow(/no active orgId/);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('stamps orgId on the repairSessions set payload', async () => {
    await completeRepairSession(VALID_ARGS);
    const setCall = _mockTransaction.set.mock.calls[0];
    // setCall[0] = doc ref, setCall[1] = payload
    expect(setCall).toBeDefined();
    const payload = setCall[1];
    expect(payload.orgId).toBe('org-xyz');
  });

  it('includes ticketId and technicianUid alongside orgId', async () => {
    await completeRepairSession(VALID_ARGS);
    const payload = _mockTransaction.set.mock.calls[0][1];
    expect(payload.ticketId).toBe('ticket-1');
    expect(payload.technicianUid).toBe('tech-uid');
  });
});

// ---------------------------------------------------------------------------
// BUG-422: concurrent-completion guard
// ---------------------------------------------------------------------------
describe('BUG-422 — concurrent completion guard', () => {
  it('happy path: ticket In Progress proceeds without throwing', async () => {
    await expect(completeRepairSession(VALID_ARGS)).resolves.toBeUndefined();
    expect(_mockTransaction.update).toHaveBeenCalled();
  });

  it('throws "already completed" when ticket status is Completed', async () => {
    _mockTransaction = buildMockTransaction({
      ticketStatus: 'Completed',
      ticketCompletedBy: 'tech-uid-first',
    });
    const { runTransaction } = await import('firebase/firestore');
    // Reassign so runTransaction uses the updated _mockTransaction
    runTransaction.mockImplementationOnce(async (_db, cb) => cb(_mockTransaction));

    await expect(completeRepairSession(VALID_ARGS)).rejects.toThrow(/already completed/);
  });

  it('does NOT call transaction.update when ticket is already Completed', async () => {
    _mockTransaction = buildMockTransaction({ ticketStatus: 'Completed' });
    const { runTransaction } = await import('firebase/firestore');
    runTransaction.mockImplementationOnce(async (_db, cb) => {
      try { await cb(_mockTransaction); } catch { /* expected */ }
    });

    await completeRepairSession(VALID_ARGS).catch(() => {});
    expect(_mockTransaction.update).not.toHaveBeenCalled();
  });

  it('reads the ticket doc inside the transaction callback (puts it in read-set)', async () => {
    await completeRepairSession(VALID_ARGS);
    // First get() call should be for the ticket ref
    const firstGetRef = _mockTransaction.get.mock.calls[0][0];
    expect(firstGetRef.col).toBe('maintenanceTickets');
    expect(firstGetRef.id).toBe('ticket-1');
  });

  it('reuses the same ticketRef for both get and update (required for Firestore read-set)', async () => {
    await completeRepairSession(VALID_ARGS);
    // The ref passed to transaction.get for the ticket
    const readRef = _mockTransaction.get.mock.calls[0][0];
    // Find which update call targeted maintenanceTickets
    const ticketUpdateRef = _mockTransaction.update.mock.calls.find(
      ([ref]) => ref.col === 'maintenanceTickets'
    )?.[0];
    // Same object reference — not two separate doc() calls
    expect(ticketUpdateRef).toBe(readRef);
  });
});

// ---------------------------------------------------------------------------
// BUG-445: unitCost uses live price-at-write, not stale price-at-mount
// ---------------------------------------------------------------------------
describe('BUG-445 — unitCost uses live price-at-write, not stale price-at-mount', () => {
  it('overwrites stale unitCost in aggregatedPartsUsed with live snap value', async () => {
    // Admin updated the part price to 7 after the technician loaded the page
    // (stale unitCost: 5 in VALID_ARGS, live snap returns 7)
    _mockTransaction = buildMockTransaction({ partUnitCost: 7 });
    const { runTransaction } = await import('firebase/firestore');
    runTransaction.mockImplementationOnce(async (_db, cb) => cb(_mockTransaction));

    await completeRepairSession(VALID_ARGS);

    // transaction.set is called with the repairSessions audit doc
    const auditPayload = _mockTransaction.set.mock.calls[0][1];
    expect(auditPayload.aggregatedPartsUsed[0].unitCost).toBe(7); // live price, not stale 5
  });

  it('totalPartsCost in audit doc reflects live unitCost', async () => {
    // quantity: 2, live unitCost: 7 → expected total: 14 (not 10 from stale unitCost 5)
    _mockTransaction = buildMockTransaction({ partUnitCost: 7 });
    const { runTransaction } = await import('firebase/firestore');
    runTransaction.mockImplementationOnce(async (_db, cb) => cb(_mockTransaction));

    await completeRepairSession(VALID_ARGS);

    const auditPayload = _mockTransaction.set.mock.calls[0][1];
    expect(auditPayload.totalPartsCost).toBe(14); // 2 * 7, not 2 * 5 = 10
  });
});
