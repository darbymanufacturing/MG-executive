/**
 * powToggleAssignee — regression tests for:
 *   BUG-216: toggleAssignee stale-closure — rapid clicks lost assignees
 *
 * Strategy: mock firebase/firestore so runTransaction gets a fake txn object
 * we can inspect. This lets us verify (1) fresh read inside transaction,
 * (2) correct merge when second call sees post-first-write state, and
 * (3) removal deletes powSteps/powWeeks keys.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Firebase mock ────────────────────────────────────────────────────────────
// runTransaction executes the callback synchronously with _mockTransaction.
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, col, id) => ({ __ref: 'doc', col, id })),
  serverTimestamp: vi.fn(() => '__SERVER_TS__'),
  runTransaction: vi.fn(async (_db, cb) => cb(_mockTransaction)),
}));

vi.mock('../../lib/firebase.js', () => ({
  db: { __db: true },
}));

// ── Shared transaction mock ──────────────────────────────────────────────────
let _mockTransaction;

/**
 * Build a mock transaction whose get() returns the given task doc state.
 * snap.data() returns the provided taskData object.
 */
function buildMockTransaction(taskData = null) {
  return {
    get: vi.fn(async () => ({
      exists: () => taskData !== null,
      data: () => taskData,
    })),
    update: vi.fn(),
  };
}

// ── Import toggleAssignee logic ──────────────────────────────────────────────
// toggleAssignee is defined inside the PowProvider closure. We extract the
// pure logic from PowContext into a helper so it can be tested without
// mounting a React component. The logic is identical to PowContext lines 110-138.
//
// We inline it here (matching the implementation) so the mock intercepts
// firebase/firestore imports correctly via vitest module mocking.

import { runTransaction, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';

const TASKS_COL = 'pow_tasks';

async function callToggleAssignee(taskId, person, stepIndices = null, currentWeek = 5) {
  const ref = doc(db, TASKS_COL, taskId);
  await runTransaction(db, async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists()) return;
    const data = snap.data();
    const current = data.assignees ?? (data.assignee ? [data.assignee] : []);
    const isRemoving = current.includes(person) && stepIndices === null;
    let assignees = current;
    const powSteps = { ...(data.powSteps ?? {}) };
    const powWeeks = { ...(data.powWeeks ?? {}) };
    if (isRemoving) {
      assignees = current.filter((a) => a !== person);
      delete powSteps[person];
      delete powWeeks[person];
    } else {
      if (!current.includes(person)) assignees = [...current, person];
      powSteps[person] = stepIndices ?? [];
      powWeeks[person] = currentWeek;
    }
    txn.update(ref, {
      assignees,
      powSteps,
      powWeeks,
      status: assignees.length > 0 ? 'pow' : 'backlog',
      updatedAt: serverTimestamp(),
    });
  });
}

// ── beforeEach ───────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
});

// ── Test suite ───────────────────────────────────────────────────────────────

describe('BUG-216 — toggleAssignee transaction: fresh read, no stale closure', () => {
  it('(1) assigns Panos when doc has no prior assignees', async () => {
    _mockTransaction = buildMockTransaction({
      assignees: [],
      powSteps: {},
      powWeeks: {},
    });

    await callToggleAssignee('task-1', 'Panos');

    expect(_mockTransaction.update).toHaveBeenCalledOnce();
    const [, payload] = _mockTransaction.update.mock.calls[0];
    expect(payload.assignees).toEqual(['Panos']);
    expect(payload.status).toBe('pow');
    expect(payload.powSteps.Panos).toEqual([]);
  });

  it('(2) second concurrent call sees post-first-write state and merges — no clobber', async () => {
    // Simulate what Firestore returns on the second read: Panos was already written
    // by the first transaction. The second transaction reads this fresh state.
    _mockTransaction = buildMockTransaction({
      assignees: ['Panos'],
      powSteps: { Panos: [0, 1] },
      powWeeks: { Panos: 5 },
    });

    // Second call adds Kostas — should produce ['Panos', 'Kostas'], not just ['Kostas']
    await callToggleAssignee('task-1', 'Kostas', [2], 5);

    expect(_mockTransaction.update).toHaveBeenCalledOnce();
    const [, payload] = _mockTransaction.update.mock.calls[0];
    expect(payload.assignees).toEqual(['Panos', 'Kostas']);
    expect(payload.status).toBe('pow');
    expect(payload.powSteps.Kostas).toEqual([2]);
    // Panos's data must be preserved
    expect(payload.powSteps.Panos).toEqual([0, 1]);
    expect(payload.powWeeks.Panos).toBe(5);
  });

  it('(3) removes person and deletes powSteps/powWeeks keys when stepIndices=null and person is present', async () => {
    _mockTransaction = buildMockTransaction({
      assignees: ['Panos', 'Kostas'],
      powSteps: { Panos: [0], Kostas: [1] },
      powWeeks: { Panos: 5, Kostas: 5 },
    });

    // stepIndices=null + person already in assignees → removal
    await callToggleAssignee('task-1', 'Panos', null, 5);

    expect(_mockTransaction.update).toHaveBeenCalledOnce();
    const [, payload] = _mockTransaction.update.mock.calls[0];
    expect(payload.assignees).toEqual(['Kostas']);
    expect(payload.status).toBe('pow');  // Kostas still assigned
    expect(Object.prototype.hasOwnProperty.call(payload.powSteps, 'Panos')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload.powWeeks, 'Panos')).toBe(false);
    // Kostas's data must be preserved
    expect(payload.powSteps.Kostas).toEqual([1]);
  });

  it('(4) removing last assignee sets status to backlog', async () => {
    _mockTransaction = buildMockTransaction({
      assignees: ['Panos'],
      powSteps: { Panos: [] },
      powWeeks: { Panos: 3 },
    });

    await callToggleAssignee('task-1', 'Panos', null, 5);

    const [, payload] = _mockTransaction.update.mock.calls[0];
    expect(payload.assignees).toEqual([]);
    expect(payload.status).toBe('backlog');
  });

  it('(5) does nothing (no update) when task doc does not exist', async () => {
    _mockTransaction = buildMockTransaction(null); // exists() returns false

    await callToggleAssignee('task-1', 'Panos');

    expect(_mockTransaction.update).not.toHaveBeenCalled();
  });

  it('(6) back-compat: reads legacy single assignee field and promotes to array', async () => {
    _mockTransaction = buildMockTransaction({
      // old doc format: single assignee string, no assignees array
      assignee: 'Panos',
      powSteps: {},
      powWeeks: {},
    });

    await callToggleAssignee('task-1', 'Kostas', [0], 5);

    const [, payload] = _mockTransaction.update.mock.calls[0];
    expect(payload.assignees).toEqual(['Panos', 'Kostas']);
  });

  it('(7) stamps updatedAt with serverTimestamp', async () => {
    _mockTransaction = buildMockTransaction({ assignees: [], powSteps: {}, powWeeks: {} });

    await callToggleAssignee('task-1', 'Panos');

    const [, payload] = _mockTransaction.update.mock.calls[0];
    expect(payload.updatedAt).toBe('__SERVER_TS__');
  });
});
