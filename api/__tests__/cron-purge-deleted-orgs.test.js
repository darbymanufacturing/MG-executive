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
 *
 * ADR-0023 Stage 1: identity operations (organizations / users / invites) now go
 * through Supabase. Tests mock api/_lib/supabase-admin.js for identity ops and
 * keep the Firestore mock (getDb) for the still-Firestore operational collections.
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
// Load handler with mocked supabase-admin.js (identity) + firebase-admin (Firestore ops + Auth)
// ---------------------------------------------------------------------------
async function loadHandler({ orgRows, freshDocByOrgId, memberRowsByOrgId, firestoreDb }) {
  vi.resetModules();

  // Build the Firestore db mock (still used for ORG_DATA_COLLECTIONS, UID_SCOPED_COLLECTIONS,
  // CONFIG_SINGLETONS — these are TODO(ADR-0023 Stage 3)).
  const batchMock = {
    delete: vi.fn(),
    commit: vi.fn().mockResolvedValue({}),
  };

  const db = firestoreDb || {
    collection: vi.fn((_col) => ({
      where: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ empty: true, docs: [], size: 0 }),
        limit: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({ empty: true, docs: [], size: 0 }),
        })),
      })),
      doc: vi.fn((_id) => ({ delete: vi.fn().mockResolvedValue({}) })),
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

  // Supabase admin mock for identity ops
  const supaClientMock = {
    from: vi.fn((table) => {
      if (table === 'organizations') {
        return {
          // Initial due-orgs query: .select('source_doc_id, data')
          select: vi.fn().mockResolvedValue({ data: orgRows, error: null }),
        };
      }
      return {
        select: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
    }),
  };

  // sbGetDoc for re-verify: returns the freshDoc for each orgId
  const sbGetDocMock = vi.fn(async (table, sourceDocId) => {
    if (table === 'organizations') {
      return freshDocByOrgId?.[sourceDocId] ?? null;
    }
    return null;
  });

  // sbPatchDoc for stamp/clear
  const sbPatchDocMock = vi.fn().mockResolvedValue(undefined);

  // sbDelDoc for org delete (and user deletes if called per-uid)
  const sbDelDocMock = vi.fn().mockResolvedValue(undefined);

  // sbGetByOrg for users (returns memberRows for orgId)
  const sbGetByOrgMock = vi.fn(async (table, orgId) => {
    if (table === 'users') {
      return memberRowsByOrgId?.[orgId] ?? [];
    }
    return [];
  });

  // sbDelByOrg for bulk deletes (invites, users)
  const sbDelByOrgMock = vi.fn().mockResolvedValue(0);

  vi.doMock('../_lib/supabase-admin.js', () => ({
    supabaseAdmin: () => supaClientMock,
    sbGetDoc: sbGetDocMock,
    sbPatchDoc: sbPatchDocMock,
    sbDelDoc: sbDelDocMock,
    sbGetByOrg: sbGetByOrgMock,
    sbDelByOrg: sbDelByOrgMock,
  }));

  const mod = await import('../_cron-purge-deleted-orgs.js');
  return {
    handler: mod.default,
    db,
    batchMock,
    sbGetDocMock,
    sbPatchDocMock,
    sbDelDocMock,
    sbGetByOrgMock,
    sbDelByOrgMock,
  };
}

// ---------------------------------------------------------------------------
// Tests — BUG #bug-435 TOCTOU guard
// ---------------------------------------------------------------------------
describe('cron-purge-deleted-orgs.js TOCTOU guard (BUG #bug-435)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('skips org when re-fetch shows deleteAt was cleared by cancel-delete', async () => {
    const pastIso = new Date(Date.now() - 86400000).toISOString();
    const orgId = 'org-cancel';

    // Initial Supabase query returns this org as due.
    const orgRows = [
      { source_doc_id: orgId, data: { deleteAt: pastIso, name: 'CancelledOrg' } },
    ];

    // Re-verify (sbGetDoc) returns a doc with no deleteAt — cancel-delete cleared it.
    const freshDocByOrgId = {
      [orgId]: { _docId: orgId, name: 'CancelledOrg' }, // no deleteAt
    };

    const { handler, sbPatchDocMock, sbDelDocMock } = await loadHandler({
      orgRows,
      freshDocByOrgId,
      memberRowsByOrgId: {},
    });

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);

    // No destructive operations on this org
    expect(sbDelDocMock).not.toHaveBeenCalledWith('organizations', orgId);
    // purgeStartedAt was never stamped (guard fires before the stamp)
    expect(sbPatchDocMock).not.toHaveBeenCalledWith(
      'organizations', orgId, expect.objectContaining({ purgeStartedAt: expect.anything() })
    );
    expect(res._status).toBe(200);
    expect(res._body.purged).toBe(0);
  });

  test('proceeds with deletion when re-fetch confirms deleteAt still due', async () => {
    const pastIso = new Date(Date.now() - 86400000).toISOString();
    const orgId = 'org-due';

    const orgRows = [
      { source_doc_id: orgId, data: { deleteAt: pastIso, name: 'DueOrg' } },
    ];

    // Re-verify returns deleteAt still in the past — purge should proceed.
    const freshDocByOrgId = {
      [orgId]: { _docId: orgId, deleteAt: pastIso, name: 'DueOrg' },
    };

    const { handler, sbPatchDocMock, sbDelDocMock } = await loadHandler({
      orgRows,
      freshDocByOrgId,
      memberRowsByOrgId: {},
    });

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);

    // purgeStartedAt should be stamped before destructive work
    expect(sbPatchDocMock).toHaveBeenCalledWith(
      'organizations', orgId, expect.objectContaining({ purgeStartedAt: expect.any(String) })
    );
    // Org doc itself should be deleted from Supabase
    expect(sbDelDocMock).toHaveBeenCalledWith('organizations', orgId);
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
   * Build a loadHandler variant that tracks which Firestore collections are queried
   * with which field (createdByUid vs orgId) for the still-Firestore operational
   * UID-scoped collections (briefs, bankTransactions).
   */
  async function loadHandler453({ pastIso, memberUids, uidScopedDocs }) {
    vi.resetModules();

    const orgId = 'org-453';

    // Track calls to collection().where() so we can assert on field names.
    const queriedFields = {};

    const deletedRefs = [];
    const batchMock = {
      delete: vi.fn((ref) => deletedRefs.push(ref)),
      commit: vi.fn().mockResolvedValue({}),
    };

    const db = {
      collection: vi.fn((col) => ({
        where: vi.fn((field, _op, val) => {
          if (!queriedFields[col]) queriedFields[col] = [];
          queriedFields[col].push({ field, val });

          // UID-scoped collections (briefs, bankTransactions) queried by createdByUid
          if ((col === 'briefs' || col === 'bankTransactions') && field === 'createdByUid') {
            const docs = (uidScopedDocs[col] || []).filter((d) =>
              (val instanceof Array ? val : [val]).includes(d.createdByUid)
            );
            const docRefs = docs.map((d) => ({
              ref: { _id: `${col}/${d.id}`, delete: vi.fn().mockResolvedValue({}) },
            }));
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

    const sbDelDocMock = vi.fn().mockResolvedValue(undefined);
    const sbDelByOrgMock = vi.fn().mockResolvedValue(0);

    // Supabase mocks for identity ops
    const supaClientMock = {
      from: vi.fn((table) => {
        if (table === 'organizations') {
          return {
            select: vi.fn().mockResolvedValue({
              data: [{ source_doc_id: orgId, data: { deleteAt: pastIso } }],
              error: null,
            }),
          };
        }
        return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
      }),
    };

    vi.doMock('../_lib/supabase-admin.js', () => ({
      supabaseAdmin: () => supaClientMock,
      sbGetDoc: vi.fn(async (table, sourceDocId) => {
        if (table === 'organizations' && sourceDocId === orgId) {
          return { _docId: orgId, deleteAt: pastIso };
        }
        return null;
      }),
      sbPatchDoc: vi.fn().mockResolvedValue(undefined),
      sbDelDoc: sbDelDocMock,
      sbGetByOrg: vi.fn(async (table, qOrgId) => {
        if (table === 'users' && qOrgId === orgId) {
          return memberUids.map((uid) => ({ _docId: uid, orgId }));
        }
        return [];
      }),
      sbDelByOrg: sbDelByOrgMock,
    }));

    const mod = await import('../_cron-purge-deleted-orgs.js');
    return { handler: mod.default, db, batchMock, deletedRefs, queriedFields, sbDelDocMock, sbDelByOrgMock };
  }

  test('queries briefs and bankTransactions by createdByUid, not orgId', async () => {
    const pastIso = new Date(Date.now() - 86400000).toISOString();
    const memberUids = ['uid-alice', 'uid-bob'];

    const { handler, queriedFields, sbDelDocMock } = await loadHandler453({
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

    // Org identity row must be deleted from Supabase
    expect(sbDelDocMock).toHaveBeenCalledWith('organizations', 'org-453');
  });

  test('skips UID-scoped purge loop when org has no members', async () => {
    const pastIso = new Date(Date.now() - 86400000).toISOString();

    const { handler, queriedFields, sbDelDocMock } = await loadHandler453({
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
    // Org identity row still gets deleted from Supabase
    expect(sbDelDocMock).toHaveBeenCalledWith('organizations', 'org-453');
  });
});

// ---------------------------------------------------------------------------
// BUG #457 — parallel Auth deletes
// (ADR-0023 Stage 1 note: the Firestore paged-users-fetch is replaced by
// sbGetByOrg which returns all rows in one call — the .limit(450) paging
// assertion is no longer applicable and is removed here.
// The Promise.allSettled / deleteUser-count assertions remain valid.)
// ---------------------------------------------------------------------------
describe('cron-purge-deleted-orgs.js parallel Auth deletes (BUG #457)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Build a handler that provides N member rows via sbGetByOrg (Supabase).
   * Tracks how many times deleteUser was called.
   */
  async function loadHandler457({ memberCount }) {
    vi.resetModules();

    const orgId = 'org-457';
    const pastIso = new Date(Date.now() - 86400000).toISOString();

    const allMemberRows = Array.from({ length: memberCount }, (_, i) => ({
      _docId: `uid-${i}`,
      orgId,
    }));

    const deleteUserMock = vi.fn().mockResolvedValue({});
    const allSettledSpy = vi.spyOn(Promise, 'allSettled');

    const batchMock = {
      delete: vi.fn(),
      commit: vi.fn().mockResolvedValue({}),
    };

    const db = {
      collection: vi.fn((_col) => ({
        where: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({ empty: true, docs: [], size: 0 }),
          limit: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({ empty: true, docs: [], size: 0 }),
          })),
        })),
        doc: vi.fn(() => ({ delete: vi.fn().mockResolvedValue({}) })),
      })),
      batch: vi.fn(() => batchMock),
    };

    vi.doMock('../_lib/firebase-admin.js', () => ({
      getDb: () => db,
      getAuth: () => ({ deleteUser: deleteUserMock }),
      FieldValue: {
        delete: () => ({ _delete: true }),
        serverTimestamp: () => 'SERVER_TS',
        arrayRemove: (v) => ({ _arrayRemove: v }),
      },
    }));

    vi.doMock('../_lib/require-auth.js', () => ({
      requireCronOrUser: vi.fn().mockResolvedValue({ trigger: 'cron', uid: 'cron' }),
    }));

    const sbDelDocMock = vi.fn().mockResolvedValue(undefined);
    const sbDelByOrgMock = vi.fn().mockResolvedValue(memberCount);

    const supaClientMock = {
      from: vi.fn((table) => {
        if (table === 'organizations') {
          return {
            select: vi.fn().mockResolvedValue({
              data: [{ source_doc_id: orgId, data: { deleteAt: pastIso } }],
              error: null,
            }),
          };
        }
        return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
      }),
    };

    vi.doMock('../_lib/supabase-admin.js', () => ({
      supabaseAdmin: () => supaClientMock,
      sbGetDoc: vi.fn(async (table, sourceDocId) => {
        if (table === 'organizations' && sourceDocId === orgId) {
          return { _docId: orgId, deleteAt: pastIso };
        }
        return null;
      }),
      sbPatchDoc: vi.fn().mockResolvedValue(undefined),
      sbDelDoc: sbDelDocMock,
      sbGetByOrg: vi.fn(async (table, qOrgId) => {
        if (table === 'users' && qOrgId === orgId) return allMemberRows;
        return [];
      }),
      sbDelByOrg: sbDelByOrgMock,
    }));

    const mod = await import('../_cron-purge-deleted-orgs.js');
    return {
      handler: mod.default,
      sbDelDocMock,
      deleteUserMock,
      allSettledSpy,
    };
  }

  // TODO(ADR-0023 Stage 1): the .limit(450) paging assertion from the original BUG #457 test
  // is removed — members now come from sbGetByOrg (single Supabase call, no Firestore paging).
  // Keeping the test for the correct response shape to document the change.
  test('returns { ok: true, purged: 1 } for a single expired org (60 members)', async () => {
    const { handler } = await loadHandler457({ memberCount: 60 });

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(res._body.purged).toBe(1);
  });

  test('calls deleteUser exactly 60 times for a 60-member org', async () => {
    const { handler, deleteUserMock } = await loadHandler457({ memberCount: 60 });

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(deleteUserMock).toHaveBeenCalledTimes(60);
  });

  test('uses Promise.allSettled for Auth deletes (not serial await per user)', async () => {
    const { handler, allSettledSpy } = await loadHandler457({ memberCount: 60 });

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);

    // Promise.allSettled must have been called at least once (batched concurrency).
    expect(allSettledSpy).toHaveBeenCalled();
    allSettledSpy.mockRestore();
  });

  test('response contains { ok: true, purged: 1 } for a single expired org', async () => {
    const { handler } = await loadHandler457({ memberCount: 60 });

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(res._body.purged).toBe(1);
  });

  test('regression: 500 members uses ceil(500/25)=20 allSettled rounds, not 500 serial awaits', async () => {
    const { handler, allSettledSpy } = await loadHandler457({ memberCount: 500 });

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    // With AUTH_CONCURRENCY=25, 500 members → ceil(500/25)=20 allSettled calls.
    // Verify bounded rounds: allSettled called ≤ 20 times (not 500 serial awaits).
    const allSettledCallCount = allSettledSpy.mock.calls.length;
    expect(allSettledCallCount).toBeLessThanOrEqual(20);
    expect(allSettledCallCount).toBeGreaterThan(0);
    allSettledSpy.mockRestore();
  });

  test('deletes Supabase org identity row after all member cleanup', async () => {
    const { handler, sbDelDocMock } = await loadHandler457({ memberCount: 10 });

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);

    expect(sbDelDocMock).toHaveBeenCalledWith('organizations', 'org-457');
  });
});
