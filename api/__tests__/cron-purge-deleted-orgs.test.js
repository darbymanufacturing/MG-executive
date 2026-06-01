/**
 * Regression tests for BUG #bug-435:
 * cron-purge-deleted-orgs.js must re-verify deleteAt inside the loop before
 * any destructive write. If cancel-delete cleared deleteAt between the initial
 * query snapshot and the per-org re-fetch, the org must be skipped.
 *
 * Also covers BUG #453:
 * briefs and bankTransactions must be purged via createdByUid (not orgId, which
 * was never stamped on those collections). Both collections must be fully deleted
 * when their member UIDs match.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mockRes() {
  const res = {
    _status: null,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
  };
  return res;
}

function mockReq() {
  return { method: 'GET', headers: { authorization: 'Bearer cron-secret' } };
}

// ---------------------------------------------------------------------------
// Build a minimal Firestore mock
// ---------------------------------------------------------------------------
function makeDocRef(data, { deleteRef, updateRef } = {}) {
  const ref = {
    get: vi.fn().mockResolvedValue({
      exists: data !== null,
      data: () => data,
    }),
    update: updateRef || vi.fn().mockResolvedValue({}),
    delete: deleteRef || vi.fn().mockResolvedValue({}),
  };
  return ref;
}

// ---------------------------------------------------------------------------
// Load handler with mocked firebase-admin and require-auth
// ---------------------------------------------------------------------------
async function loadHandler({ orgDocs, freshDocData }) {
  vi.resetModules();

  // Each orgDoc in the initial snapshot: { id, ref, data() }
  // freshDocData: what the re-fetch returns for each org (keyed by orgId)
  const batchMock = {
    delete: vi.fn(),
    commit: vi.fn().mockResolvedValue({}),
  };

  const db = {
    collection: vi.fn((col) => ({
      where: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({
          empty: orgDocs.length === 0,
          docs: orgDocs,
        }),
        limit: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({ empty: true, docs: [], size: 0 }),
        })),
      })),
      doc: vi.fn((id) => makeDocRef({})),
    })),
    batch: vi.fn(() => batchMock),
  };

  // Override ref.get() on each orgDoc to return freshDocData[orgId]
  orgDocs.forEach((orgDoc) => {
    const fresh = freshDocData[orgDoc.id];
    orgDoc.ref.get = vi.fn().mockResolvedValue({
      exists: fresh !== null,
      data: () => fresh,
    });
  });

  vi.doMock('../_lib/firebase-admin.js', () => ({
    getDb: () => db,
    getAuth: () => ({ deleteUser: vi.fn().mockResolvedValue({}) }),
    FieldValue: {
      delete: () => ({ _delete: true }),
      serverTimestamp: () => 'SERVER_TS',
      arrayRemove: (v) => ({ _arrayRemove: v }),
    },
  }));

  vi.doMock('../_lib/require-auth.js', () => ({
    requireCronOrUser: vi.fn().mockResolvedValue({ trigger: 'cron', uid: 'cron' }),
  }));

  const mod = await import('../cron-purge-deleted-orgs.js');
  return { handler: mod.default, db, batchMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('cron-purge-deleted-orgs.js TOCTOU guard (BUG #bug-435)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('skips org when re-fetch shows deleteAt was cleared by cancel-delete', async () => {
    const orgRef = {
      get: vi.fn(), // overridden below per-org
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };

    const pastIso = new Date(Date.now() - 86400000).toISOString();
    const orgDoc = {
      id: 'org-cancel',
      ref: orgRef,
      data: () => ({ deleteAt: pastIso, name: 'CancelledOrg' }),
    };

    const { handler } = await loadHandler({
      orgDocs: [orgDoc],
      freshDocData: {
        // cancel-delete cleared deleteAt — fresh doc has no deleteAt
        'org-cancel': { name: 'CancelledOrg' },
      },
    });

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);

    // No destructive operations on this org
    expect(orgRef.delete).not.toHaveBeenCalled();
    // purgeStartedAt was never stamped either (guard fires before the stamp)
    expect(orgRef.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ purgeStartedAt: expect.anything() })
    );
    expect(res._status).toBe(200);
    expect(res._body.purged).toBe(0);
  });

  test('proceeds with deletion when re-fetch confirms deleteAt still due', async () => {
    const orgRef = {
      get: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };

    const pastIso = new Date(Date.now() - 86400000).toISOString();
    const orgDoc = {
      id: 'org-due',
      ref: orgRef,
      data: () => ({ deleteAt: pastIso, name: 'DueOrg' }),
    };

    const { handler } = await loadHandler({
      orgDocs: [orgDoc],
      freshDocData: {
        // deleteAt still in the past — purge should proceed
        'org-due': { deleteAt: pastIso, name: 'DueOrg' },
      },
    });

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);

    // purgeStartedAt should be stamped before destructive work
    expect(orgRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ purgeStartedAt: expect.any(String) })
    );
    // Org doc itself should be deleted
    expect(orgRef.delete).toHaveBeenCalled();
    expect(res._status).toBe(200);
    expect(res._body.purged).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// BUG #453 — UID-scoped collections (briefs, bankTransactions) must be purged
// ---------------------------------------------------------------------------
describe('cron-purge-deleted-orgs.js UID-scoped purge (BUG #453)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Build a loadHandler variant that tracks which collections are queried with
   * which field (orgId vs createdByUid) and which docs are batch-deleted.
   */
  async function loadHandler453({ pastIso, memberUids, uidScopedDocs }) {
    vi.resetModules();

    const orgId = 'org-453';
    const orgRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ deleteAt: pastIso }),
      }),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };

    const deletedRefs = [];
    const batchMock = {
      delete: vi.fn((ref) => deletedRefs.push(ref)),
      commit: vi.fn().mockResolvedValue({}),
    };

    // Track calls to collection().where() so we can assert on field names.
    const queriedFields = {};

    const db = {
      collection: vi.fn((col) => ({
        where: vi.fn((field, _op, val) => {
          if (!queriedFields[col]) queriedFields[col] = [];
          queriedFields[col].push({ field, val });

          // users collection — return member docs for orgId query
          if (col === 'users' && field === 'orgId') {
            const memberDocs = memberUids.map((uid) => ({
              id: uid,
              ref: { delete: vi.fn().mockResolvedValue({}) },
              data: () => ({ orgId }),
            }));
            return {
              get: vi.fn().mockResolvedValue({ empty: memberDocs.length === 0, docs: memberDocs }),
              limit: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ empty: true, docs: [], size: 0 }) })),
            };
          }

          // organizations initial query
          if (col === 'organizations') {
            const orgDoc = { id: orgId, ref: orgRef, data: () => ({ deleteAt: pastIso }) };
            return {
              get: vi.fn().mockResolvedValue({ empty: false, docs: [orgDoc] }),
              limit: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ empty: true, docs: [], size: 0 }) })),
            };
          }

          // UID-scoped collections (briefs, bankTransactions) queried by createdByUid
          if ((col === 'briefs' || col === 'bankTransactions') && field === 'createdByUid') {
            const docs = (uidScopedDocs[col] || []).filter((d) =>
              (val instanceof Array ? val : [val]).includes(d.createdByUid)
            );
            const docRefs = docs.map((d) => ({
              ref: { _id: `${col}/${d.id}`, delete: vi.fn().mockResolvedValue({}) },
            }));
            // Return page then empty on next call (simulate draining).
            let called = 0;
            return {
              get: vi.fn().mockResolvedValue({ empty: false, docs: docRefs, size: docRefs.length }),
              limit: vi.fn(() => {
                called += 1;
                if (called === 1) {
                  return {
                    get: vi.fn().mockResolvedValue({ empty: docs.length === 0, docs: docRefs, size: docRefs.length }),
                  };
                }
                return { get: vi.fn().mockResolvedValue({ empty: true, docs: [], size: 0 }) };
              }),
            };
          }

          // All other ORG_DATA_COLLECTIONS — return empty (no data to delete).
          return {
            get: vi.fn().mockResolvedValue({ empty: true, docs: [], size: 0 }),
            limit: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ empty: true, docs: [], size: 0 }) })),
          };
        }),
        doc: vi.fn(() => ({ delete: vi.fn().mockResolvedValue({}) })),
      })),
      batch: vi.fn(() => batchMock),
    };

    vi.doMock('../_lib/firebase-admin.js', () => ({
      getDb: () => db,
      getAuth: () => ({ deleteUser: vi.fn().mockResolvedValue({}) }),
      FieldValue: {
        delete: () => ({ _delete: true }),
        serverTimestamp: () => 'SERVER_TS',
        arrayRemove: (v) => ({ _arrayRemove: v }),
      },
    }));

    vi.doMock('../_lib/require-auth.js', () => ({
      requireCronOrUser: vi.fn().mockResolvedValue({ trigger: 'cron', uid: 'cron' }),
    }));

    const mod = await import('../cron-purge-deleted-orgs.js');
    return { handler: mod.default, db, batchMock, deletedRefs, queriedFields, orgRef };
  }

  test('queries briefs and bankTransactions by createdByUid, not orgId', async () => {
    const pastIso = new Date(Date.now() - 86400000).toISOString();
    const memberUids = ['uid-alice', 'uid-bob'];

    const { handler, queriedFields, orgRef } = await loadHandler453({
      pastIso,
      memberUids,
      uidScopedDocs: {
        briefs: [
          { id: 'brief-1', createdByUid: 'uid-alice' },
          { id: 'brief-2', createdByUid: 'uid-bob' },
        ],
        bankTransactions: [
          { id: 'tx-1', createdByUid: 'uid-alice' },
        ],
      },
    });

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.purged).toBe(1);

    // briefs must have been queried by createdByUid, NOT orgId
    expect(queriedFields['briefs']).toBeDefined();
    const briefsOrgIdQuery = (queriedFields['briefs'] || []).find((q) => q.field === 'orgId');
    expect(briefsOrgIdQuery).toBeUndefined(); // orgId query must NOT exist for briefs
    const briefsUidQuery = (queriedFields['briefs'] || []).find((q) => q.field === 'createdByUid');
    expect(briefsUidQuery).toBeDefined();

    // bankTransactions must have been queried by createdByUid, NOT orgId
    expect(queriedFields['bankTransactions']).toBeDefined();
    const btOrgIdQuery = (queriedFields['bankTransactions'] || []).find((q) => q.field === 'orgId');
    expect(btOrgIdQuery).toBeUndefined();
    const btUidQuery = (queriedFields['bankTransactions'] || []).find((q) => q.field === 'createdByUid');
    expect(btUidQuery).toBeDefined();

    // Org doc itself must be deleted
    expect(orgRef.delete).toHaveBeenCalled();
  });

  test('skips UID-scoped purge loop when org has no members', async () => {
    const pastIso = new Date(Date.now() - 86400000).toISOString();

    const { handler, queriedFields, orgRef } = await loadHandler453({
      pastIso,
      memberUids: [], // no members
      uidScopedDocs: {},
    });

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    // briefs and bankTransactions should never be queried when there are no members
    expect(queriedFields['briefs']).toBeUndefined();
    expect(queriedFields['bankTransactions']).toBeUndefined();
    // Org doc still gets deleted
    expect(orgRef.delete).toHaveBeenCalled();
  });
});
