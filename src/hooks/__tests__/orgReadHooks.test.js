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

  it('fails loud (throws) when the org resolved but is absent', () => {
    useOrg.mockReturnValue({ orgId: null, loading: false });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useOrgCollection('costs'))).toThrow(/requires an orgId/);
    spy.mockRestore();
  });

  it('stays loading (no query) while the org is still resolving', () => {
    useOrg.mockReturnValue({ orgId: null, loading: true });
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

  it('fails loud (throws) when the org resolved but is absent', () => {
    useOrg.mockReturnValue({ orgId: null, loading: false });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useOrgDoc('config', 'whatever'))).toThrow(/requires an orgId/);
    spy.mockRestore();
  });
});
