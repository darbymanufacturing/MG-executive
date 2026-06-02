/**
 * useOrgCollection / useOrgDoc — the ADR-0003 leak-proof READ layer. These lock
 * the single most important multi-tenancy invariant: every query is filtered by
 * the active org, a mis-targeted doc can never surface another org's data, and a
 * resolved-but-absent org fails loud rather than returning unscoped/empty data.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../../lib/firebase.js', () => ({ db: { __db: true } }));
vi.mock('../../context/OrgContext.jsx', () => ({ useOrg: vi.fn() }));

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

// Force the FIRESTORE branch — these tests cover the Firestore read path (onSnapshot).
// The global default is now 'supabase' (ADR-0015); the Supabase read path is covered by
// the useSupabaseLive / useSupabaseTable suites.
vi.mock('../../lib/dataLayerConfig.js', () => ({
  layerFor: () => 'firestore',
  isSupabaseLayer: () => false,
  GLOBAL_DATA_LAYER: 'firestore',
  DATA_LAYER_OVERRIDES: {},
}));

import { useOrg } from '../../context/OrgContext.jsx';
import { useOrgCollection } from '../useOrgCollection.js';
import { useOrgDoc } from '../useOrgDoc.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useOrgCollection', () => {
  it('injects where(orgId == activeOrg) into every query and maps docs', () => {
    useOrg.mockReturnValue({ orgId: 'org-A', loading: false });
    onSnapshotMock.mockImplementation((_q, onNext) => {
      onNext({ docs: [{ id: 'd1', data: () => ({ orgId: 'org-A', name: 'A' }) }] });
      return () => {};
    });
    const { result } = renderHook(() => useOrgCollection('costs'));
    expect(where).toHaveBeenCalledWith('orgId', '==', 'org-A');
    expect(result.current.items).toEqual([{ _docId: 'd1', orgId: 'org-A', name: 'A' }]);
    expect(result.current.loading).toBe(false);
  });

  it('fails loud (throws) when the org resolved but is absent and user is signed in', () => {
    useOrg.mockReturnValue({ orgId: null, loading: false, hasUser: true });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useOrgCollection('costs'))).toThrow(/requires an orgId/);
    spy.mockRestore();
  });

  it('stays loading (no query) while the org is still resolving', () => {
    useOrg.mockReturnValue({ orgId: null, loading: true, hasUser: false });
    const { result } = renderHook(() => useOrgCollection('costs'));
    expect(result.current.loading).toBe(true);
    expect(where).not.toHaveBeenCalled();
  });

  it('does NOT throw (stays loading) when orgId is null but no user is signed in yet (bug #454)', () => {
    // Race window: auth resolved (loading=false) but userProfile hasn't populated yet
    useOrg.mockReturnValue({ orgId: null, loading: false, hasUser: false });
    const { result } = renderHook(() => useOrgCollection('costs'));
    expect(result.current.loading).toBe(true);
    expect(where).not.toHaveBeenCalled();
  });
});

describe('useOrgDoc', () => {
  it('returns the doc when its orgId matches the active org', () => {
    useOrg.mockReturnValue({ orgId: 'org-A', loading: false });
    onSnapshotMock.mockImplementation((_ref, onNext) => {
      onNext({ exists: () => true, id: 'org-A_fleet', data: () => ({ orgId: 'org-A', fleetSize: 20 }) });
      return () => {};
    });
    const { result } = renderHook(() => useOrgDoc('config', 'org-A_fleet'));
    expect(result.current.item).toEqual({ _docId: 'org-A_fleet', orgId: 'org-A', fleetSize: 20 });
  });

  it("never surfaces another org's doc (defense-in-depth)", () => {
    useOrg.mockReturnValue({ orgId: 'org-A', loading: false });
    onSnapshotMock.mockImplementation((_ref, onNext) => {
      onNext({ exists: () => true, id: 'org-B_fleet', data: () => ({ orgId: 'org-B', fleetSize: 99 }) });
      return () => {};
    });
    const { result } = renderHook(() => useOrgDoc('config', 'org-B_fleet'));
    expect(result.current.item).toBe(null);
  });

  it('fails loud (throws) when the org resolved but is absent and user is signed in', () => {
    useOrg.mockReturnValue({ orgId: null, loading: false, hasUser: true });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useOrgDoc('config', 'whatever'))).toThrow(/requires an orgId/);
    spy.mockRestore();
  });

  it('does NOT throw (stays loading) when orgId is null but no user is signed in yet (bug #454)', () => {
    // Race window: auth resolved (loading=false) but userProfile hasn't populated yet
    useOrg.mockReturnValue({ orgId: null, loading: false, hasUser: false });
    const { result } = renderHook(() => useOrgDoc('config', 'whatever'));
    expect(result.current.loading).toBe(true);
  });

  it('never initiates a Firestore subscription for a cross-org prefixed docId (pre-read block)', () => {
    // Bug #429: the old code called onSnapshot before checking the prefix, causing
    // a brief window where another org's document was delivered to browser memory.
    useOrg.mockReturnValue({ orgId: 'org-A', loading: false });
    const { result } = renderHook(() => useOrgDoc('config', 'org-B_fleet'));
    // The subscription must be blocked before Firestore is even contacted.
    expect(onSnapshotMock).not.toHaveBeenCalled();
    expect(result.current.item).toBe(null);
    expect(result.current.loading).toBe(false);
  });
});
