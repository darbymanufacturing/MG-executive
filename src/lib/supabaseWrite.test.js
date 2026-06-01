import { describe, it, expect, vi, beforeEach } from 'vitest';

// Controllable Supabase client mock (real supabaseRowMap is used — it's pure).
const mockUpsert = vi.fn().mockResolvedValue({ error: null });
const mockRpc = vi.fn();
const deleteEqB = vi.fn();
const _from = {
  upsert: mockUpsert,
  delete: vi.fn(() => {
    // delete().eq('org_id').eq('source_doc_id') → thenable resolving { error }
    const chain = { eq: vi.fn(() => { deleteEqB(); return chain; }), then: (res) => res({ error: null }) };
    return chain;
  }),
};
const mockFrom = vi.fn(() => _from);
vi.mock('./supabase.js', () => ({
  supabase: { from: (...a) => mockFrom(...a), rpc: (...a) => mockRpc(...a) },
}));

import {
  sbWrite, sbUpsertMerge, sbUpdate, sbDelete, sbTransaction,
  prepareSupabasePatch, friendlySupabaseError,
} from './supabaseWrite.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockUpsert.mockResolvedValue({ error: null });
});

describe('prepareSupabasePatch (arrayUnion → $append)', () => {
  it('passes plain fields through, no $append', () => {
    const { plain, append } = prepareSupabasePatch({ status: 'done', count: 3 });
    expect(plain).toEqual({ status: 'done', count: 3 });
    expect(append).toBeNull();
  });

  it('routes a Firestore arrayUnion sentinel into $append', () => {
    const sentinel = { _methodName: 'arrayUnion', _elements: [{ note: 'hi' }] };
    const { plain, append } = prepareSupabasePatch({ notes: sentinel, status: 'open' });
    expect(plain).toEqual({ status: 'open' });
    expect(append).toEqual({ notes: [{ note: 'hi' }] });
  });

  it('drops non-arrayUnion FieldValue sentinels (e.g. serverTimestamp)', () => {
    const { plain, append } = prepareSupabasePatch({ updatedAt: { _methodName: 'serverTimestamp' }, x: 1 });
    expect(plain).toEqual({ x: 1 });
    expect(append).toBeNull();
  });
});

describe('sbWrite', () => {
  it('auto-id: upserts with a generated source_doc_id + stamps, returns {id}', async () => {
    const res = await sbWrite('costs', 'org1', 'uid9', { name: 'Rent', amount: 100 });
    expect(res.id).toEqual(expect.any(String));
    expect(res.id.length).toBeGreaterThan(0);
    expect(mockFrom).toHaveBeenCalledWith('costs');
    const [rows, opts] = mockUpsert.mock.calls[0];
    expect(opts).toEqual({ onConflict: 'source_doc_id' });
    expect(rows.org_id).toBe('org1');
    expect(rows.source_doc_id).toBe(res.id);
    expect(rows.data.createdByUid).toBe('uid9');
    expect(rows.data.createdAt).toEqual(expect.any(String)); // concrete ISO, not a sentinel
    expect(rows.data.name).toBe('Rent');
  });

  it('explicit id: uses it as source_doc_id', async () => {
    const res = await sbWrite('costs', 'org1', 'uid9', { name: 'X' }, { id: 'org1_abc' });
    expect(res.id).toBe('org1_abc');
    expect(mockUpsert.mock.calls[0][0].source_doc_id).toBe('org1_abc');
  });

  it('throws on an unknown collection (no Supabase table mapping)', async () => {
    await expect(sbWrite('nope', 'org1', 'u', {})).rejects.toThrow(/no Supabase table/i);
  });

  it('throws a friendly error when upsert returns an error', async () => {
    mockUpsert.mockResolvedValueOnce({ error: { message: 'duplicate key value' } });
    await expect(sbWrite('costs', 'org1', 'u', {})).rejects.toThrow(/already exists/i);
  });
});

describe('sbUpsertMerge (config setDoc-merge parity)', () => {
  it('merges via apply_doc_patch when the row exists', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const res = await sbUpsertMerge('config', 'org1', 'u', 'org1_fleet', { rate: 9 });
    expect(res).toEqual({ id: 'org1_fleet' });
    expect(mockRpc).toHaveBeenCalledWith('apply_doc_patch', expect.objectContaining({
      p_table: 'app_config', p_source_doc_id: 'org1_fleet',
    }));
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('falls back to an insert when the row does not exist yet', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'apply_doc_patch: org1_fleet not found' } });
    const res = await sbUpsertMerge('config', 'org1', 'u', 'org1_fleet', { rate: 9 });
    expect(res).toEqual({ id: 'org1_fleet' });
    expect(mockUpsert).toHaveBeenCalledTimes(1); // inserted the full doc
  });
});

describe('sbUpdate', () => {
  it('calls apply_doc_patch with the plain patch', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    await sbUpdate('issues', 'org1', 'org1_i1', { status: 'closed' });
    expect(mockRpc).toHaveBeenCalledWith('apply_doc_patch', {
      p_table: 'issues', p_source_doc_id: 'org1_i1', p_patch: { status: 'closed' },
    });
  });

  it('translates an arrayUnion patch into a $append directive', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const sentinel = { _methodName: 'arrayUnion', _elements: ['n1'] };
    await sbUpdate('issues', 'org1', 'org1_i1', { notes: sentinel });
    expect(mockRpc.mock.calls[0][1].p_patch).toEqual({ $append: { notes: ['n1'] } });
  });
});

describe('sbDelete', () => {
  it('deletes by org_id + source_doc_id, returns {id}', async () => {
    const res = await sbDelete('revenue', 'org1', 'org1_2026-01-01_global');
    expect(res).toEqual({ id: 'org1_2026-01-01_global' });
    expect(mockFrom).toHaveBeenCalledWith('revenue_days');
    expect(deleteEqB).toHaveBeenCalledTimes(2); // .eq(org_id).eq(source_doc_id)
  });
});

describe('sbTransaction (optimistic CAS)', () => {
  it('reads → mutates → commits (version match)', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: { found: true, data: { name: 'P', blockers: [] }, version: 4 }, error: null }) // rmw_read
      .mockResolvedValueOnce({ data: 1, error: null }); // rmw_commit → 1 row
    const mutator = vi.fn((d) => ({ blockers: [...d.blockers, 'b1'] }));
    await sbTransaction('projects', 'org1', 'org1_p1', mutator);
    expect(mutator).toHaveBeenCalledWith({ name: 'P', blockers: [] });
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'rmw_commit', expect.objectContaining({
      p_table: 'projects', p_source_doc_id: 'org1_p1', p_expected_version: 4,
    }));
  });

  it('retries on a lost version race (commit returns 0 rows)', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: { found: true, data: { v: 1 }, version: 1 }, error: null }) // read
      .mockResolvedValueOnce({ data: 0, error: null }) // commit lost the race
      .mockResolvedValueOnce({ data: { found: true, data: { v: 1 }, version: 2 }, error: null }) // re-read
      .mockResolvedValueOnce({ data: 1, error: null }); // commit wins
    await sbTransaction('projects', 'org1', 'org1_p1', (d) => ({ ...d }));
    expect(mockRpc).toHaveBeenCalledTimes(4);
  });

  it('throws when the doc is not found', async () => {
    mockRpc.mockResolvedValueOnce({ data: { found: false, data: {}, version: 0 }, error: null });
    await expect(sbTransaction('projects', 'org1', 'org1_missing', (d) => d)).rejects.toThrow(/not found/i);
  });
});

describe('friendlySupabaseError', () => {
  it('maps common Postgres/RLS errors to readable messages', () => {
    expect(friendlySupabaseError({ message: 'duplicate key value' }).message).toMatch(/already exists/i);
    expect(friendlySupabaseError({ message: 'new row violates row-level security policy' }).message).toMatch(/access/i);
    expect(friendlySupabaseError(null, 'fallback').message).toBe('fallback');
  });
});
