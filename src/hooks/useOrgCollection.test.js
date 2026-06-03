/**
 * useOrgCollection — Bug #291 regression suite.
 *
 * Verifies that the synchronous-throw-to-error-state conversion is correct:
 *   • orgId=null + hasUser=true (the crash race) → returns error state (no throw)
 *   • orgId=null + hasUser=false (no user yet)   → stays loading (no throw)
 *   • orgId=present                              → subscribes and returns data
 *
 * This guards against re-introducing the sync throw that caused the outermost
 * ErrorBoundary to call window.location.reload() during reconciliation, tearing
 * down every Firestore/Supabase listener (Bug #291).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../lib/firebase.js', () => ({ db: { __db: true } }));
vi.mock('../context/OrgContext.jsx', () => ({ useOrg: vi.fn() }));

const where = vi.fn((...a) => ({ __where: a }));
const onSnapshotMock = vi.fn();
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ __collection: true })),
  query: vi.fn((...a) => ({ __query: a })),
  where: (...a) => where(...a),
  orderBy: vi.fn((...a) => ({ __orderBy: a })),
  limit: vi.fn((...a) => ({ __limit: a })),
  doc: vi.fn((_db, col, id) => ({ __doc: true, col, id })),
  onSnapshot: (...a) => onSnapshotMock(...a),
}));

// Force the Firestore branch — these tests cover the Firestore read path.
vi.mock('../lib/dataLayerConfig.js', () => ({
  layerFor: () => 'firestore',
  isSupabaseLayer: () => false,
  GLOBAL_DATA_LAYER: 'firestore',
  DATA_LAYER_OVERRIDES: {},
}));

import { useOrg } from '../context/OrgContext.jsx';
import { useOrgCollection } from './useOrgCollection.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useOrgCollection — Bug #291 error-state regression', () => {
  it('returns error state (does NOT throw) when org resolved but orgId absent and user is signed in', () => {
    // This is the crash race: ErrorBoundary reset cycle rerenders providers while
    // OrgContext.orgId is transiently null. The hook must NOT throw — a sync throw
    // propagates to the outermost ErrorBoundary which calls window.location.reload().
    useOrg.mockReturnValue({ orgId: null, loading: false, hasUser: true });

    // No ErrorBoundary wrapping needed — if the hook still throws, renderHook will throw.
    const { result } = renderHook(() => useOrgCollection('costs'));

    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error.message).toMatch(/requires an orgId/);
    expect(result.current.hasMore).toBe(false);
    // Verify no Firestore query was issued
    expect(where).not.toHaveBeenCalled();
    expect(onSnapshotMock).not.toHaveBeenCalled();
  });

  it('stays loading (no query) while orgId is null but no user signed in (bug #454 guard)', () => {
    useOrg.mockReturnValue({ orgId: null, loading: false, hasUser: false });
    const { result } = renderHook(() => useOrgCollection('costs'));
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(where).not.toHaveBeenCalled();
  });

  it('stays loading while org is still resolving', () => {
    useOrg.mockReturnValue({ orgId: null, loading: true, hasUser: false });
    const { result } = renderHook(() => useOrgCollection('costs'));
    expect(result.current.loading).toBe(true);
    expect(where).not.toHaveBeenCalled();
  });

  it('subscribes and returns data on the happy path (orgId present)', () => {
    useOrg.mockReturnValue({ orgId: 'org-A', loading: false, hasUser: true });
    onSnapshotMock.mockImplementation((_q, onNext) => {
      onNext({ docs: [{ id: 'd1', data: () => ({ orgId: 'org-A', name: 'Widget' }) }] });
      return () => {};
    });
    const { result } = renderHook(() => useOrgCollection('costs'));
    expect(where).toHaveBeenCalledWith('orgId', '==', 'org-A');
    expect(result.current.items).toEqual([{ _docId: 'd1', orgId: 'org-A', name: 'Widget' }]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
