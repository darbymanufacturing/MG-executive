/**
 * TelemetryContext regression — bug #378
 *
 * Verifies that:
 *   1. MAX_EVENTS cap passed to useOrgTable is 500, not 20000.
 *   2. orderBy option includes 'timestamp' so the subscription returns
 *      the most-recent events rather than an arbitrary window.
 *   3. loadMore and hasMore are present on the context value so PME
 *      analytics components can page in more events on demand.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

// ── Stubs ─────────────────────────────────────────────────────────────────────

const mockLoadMore = vi.fn();
const mockUseOrgTable = vi.fn(() => ({
  items: [],
  loading: false,
  error: null,
  loadMore: mockLoadMore,
  hasMore: false,
}));

vi.mock('../hooks/useSupabaseTable.js', () => ({
  useOrgTable: (...args) => mockUseOrgTable(...args),
}));

vi.mock('./OrgContext.jsx', () => ({
  useOrg: () => ({ orgId: 'org-test' }),
}));

vi.mock('../lib/firebase.js', () => ({
  db: {},
  auth: { currentUser: { uid: 'u1' } },
}));

vi.mock('firebase/firestore', () => ({
  collection:      vi.fn(),
  doc:             vi.fn(),
  writeBatch:      vi.fn(() => ({ set: vi.fn(), delete: vi.fn(), commit: vi.fn(() => Promise.resolve()) })),
  getDocs:         vi.fn(() => Promise.resolve({ empty: true, docs: [] })),
  query:           vi.fn(),
  where:           vi.fn(),
  serverTimestamp: vi.fn(),
}));

vi.mock('../utils/classifyEventType.js', () => ({
  classifyEventType: vi.fn(() => 'available'),
}));

vi.mock('../utils/firestoreWrite.js', () => ({
  safeWrite: vi.fn(async (writer) => { await writer(); return { ok: true }; }),
}));

vi.mock('../utils/orgDocId.js', () => ({
  orgDocId: vi.fn((orgId, id) => `${orgId}_${id}`),
}));

vi.mock('../lib/supabase.js', () => ({
  dualWriteSupabase:    vi.fn(() => Promise.resolve()),
  DATA_LAYER:           'firestore',
  isSupabaseConfigured: false,
  supabase:             null,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { TelemetryProvider, useTelemetry } from './TelemetryContext.jsx';

// A consumer that captures context value.
let capturedCtx = null;
function Consumer() {
  capturedCtx = useTelemetry();
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedCtx = null;
  mockUseOrgTable.mockReturnValue({
    items: [],
    loading: false,
    error: null,
    loadMore: mockLoadMore,
    hasMore: true,
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TelemetryContext (bug #378)', () => {
  it('passes limit of 500 (not 20000) to useOrgTable', async () => {
    render(
      <TelemetryProvider>
        <Consumer />
      </TelemetryProvider>
    );
    await waitFor(() => expect(mockUseOrgTable).toHaveBeenCalled());

    const [, , perLayer] = mockUseOrgTable.mock.calls[0];
    expect(perLayer.firestore.limit).toBe(500);
    expect(perLayer.supabase.limit).toBe(500);
  });

  it('passes orderBy with "timestamp" to useOrgTable', async () => {
    render(
      <TelemetryProvider>
        <Consumer />
      </TelemetryProvider>
    );
    await waitFor(() => expect(mockUseOrgTable).toHaveBeenCalled());

    const [, , perLayer] = mockUseOrgTable.mock.calls[0];
    expect(perLayer.firestore.orderBy[0]).toBe('timestamp');
    // #477/#478 — the Supabase typed column is `event_ts`, not `timestamp`
    // (ordering by a non-existent column would error the query on flip).
    expect(perLayer.supabase.orderBy[0]).toBe('event_ts');
  });

  it('exposes loadMore function on the context value', async () => {
    render(
      <TelemetryProvider>
        <Consumer />
      </TelemetryProvider>
    );
    await waitFor(() => expect(capturedCtx).not.toBeNull());
    expect(typeof capturedCtx.loadMore).toBe('function');
  });

  it('exposes hasMore boolean on the context value', async () => {
    render(
      <TelemetryProvider>
        <Consumer />
      </TelemetryProvider>
    );
    await waitFor(() => expect(capturedCtx).not.toBeNull());
    expect(capturedCtx).toHaveProperty('hasMore');
    expect(capturedCtx.hasMore).toBe(true);
  });
});
