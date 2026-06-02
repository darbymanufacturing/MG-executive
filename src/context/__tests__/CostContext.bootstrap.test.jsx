/**
 * CostContext bootstrap guard — regression test for bug-423.
 *
 * Verifies that the per-org bootstrap guard (moved from module-level Set to
 * useRef) correctly:
 *   1. Seeds config on first mount when no configItem exists.
 *   2. Does NOT double-write within a single mount (StrictMode safety).
 *   3. Reseeds after the provider unmounts and remounts with the same orgId
 *      (proves the Set is cleared — the fix for the actual bug).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';

// ── Stubs ────────────────────────────────────────────────────────────────────

// orgWrite spy — captured here so each test can inspect call count.
const mockOrgWrite = vi.fn(() => Promise.resolve({ ok: true }));

vi.mock('../../hooks/orgWrite.js', () => ({
  orgWrite:  (...a) => mockOrgWrite(...a),
  orgUpdate: vi.fn(() => Promise.resolve({ ok: true })),
  orgDelete: vi.fn(() => Promise.resolve({ ok: true })),
}));

// useOrgDoc: simulate "no config doc" (configItem = null, loading = false).
const mockUseOrgDoc = vi.fn(() => ({ item: null, loading: false }));
vi.mock('../../hooks/useOrgDoc.js', () => ({
  useOrgDoc: (...a) => mockUseOrgDoc(...a),
}));

// useOrgCollection: return empty list, not loading.
vi.mock('../../hooks/useOrgCollection.js', () => ({
  useOrgCollection: vi.fn(() => ({ items: [], loading: false })),
}));

// OrgContext: provide a fixed orgId.
let currentOrgId = 'org-test';
vi.mock('../OrgContext.jsx', () => ({
  useOrg: () => ({ orgId: currentOrgId }),
}));

// Firebase / Firestore — not called by bootstrap path, but imported transitively.
vi.mock('firebase/firestore', () => ({
  collection:       vi.fn(),
  doc:              vi.fn(),
  writeBatch:       vi.fn(() => ({ set: vi.fn(), delete: vi.fn(), commit: vi.fn(() => Promise.resolve()) })),
  getDocs:          vi.fn(() => Promise.resolve({ empty: true, docs: [] })),
  query:            vi.fn(),
  where:            vi.fn(),
  limit:            vi.fn(),
}));
vi.mock('../../lib/firebase.js', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('../../utils/firestoreWrite.js', () => ({
  safeWrite: vi.fn(async (writer) => { await writer(); return { ok: true }; }),
}));
vi.mock('../../utils/constants.js', () => ({
  DEFAULT_CONFIG: { mockDefault: true },
}));
vi.mock('../../utils/sampleData.js', () => ({
  SAMPLE_COSTS:  [],
  SAMPLE_CONFIG: {},
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { CostProvider } from '../CostContext.jsx';

function Wrapper() {
  return <CostProvider><span data-testid="child">ok</span></CostProvider>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  currentOrgId = 'org-test';
  // Default: no config item exists, not loading.
  mockUseOrgDoc.mockReturnValue({ item: null, loading: false });
});

describe('CostContext bootstrap guard (bug-423)', () => {
  it('calls orgWrite once on first mount when config doc is absent', async () => {
    const { unmount } = render(<Wrapper />);
    await waitFor(() => expect(mockOrgWrite).toHaveBeenCalledTimes(1));
    const [col, , opts] = mockOrgWrite.mock.calls[0];
    expect(col).toBe('config');
    expect(opts?.id).toBe('org-test_fleet');
    unmount();
  });

  it('does NOT call orgWrite a second time within the same mount (StrictMode / re-render)', async () => {
    const { rerender, unmount } = render(<Wrapper />);
    await waitFor(() => expect(mockOrgWrite).toHaveBeenCalledTimes(1));
    // Trigger a second render — the ref guard should block a second write.
    await act(async () => { rerender(<Wrapper />); });
    expect(mockOrgWrite).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('calls orgWrite again after provider unmounts and remounts with same orgId (bug-423 regression)', async () => {
    // First mount — seeds once.
    const { unmount } = render(<Wrapper />);
    await waitFor(() => expect(mockOrgWrite).toHaveBeenCalledTimes(1));
    unmount();

    // Clear spy so we count from zero for the second mount.
    mockOrgWrite.mockClear();

    // Second mount (same orgId) — a fresh useRef means the Set is empty again,
    // so the bootstrap must fire a second time.
    const { unmount: unmount2 } = render(<Wrapper />);
    await waitFor(() => expect(mockOrgWrite).toHaveBeenCalledTimes(1));
    unmount2();
  });

  it('does NOT call orgWrite when configItem already exists', async () => {
    mockUseOrgDoc.mockReturnValue({ item: { mockDefault: true, _docId: 'org-test_fleet' }, loading: false });
    const { unmount } = render(<Wrapper />);
    // Give the effect a chance to run.
    await act(async () => {});
    expect(mockOrgWrite).not.toHaveBeenCalled();
    unmount();
  });
});
