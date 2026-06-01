/**
 * TelemetryContext dedup regression — bug #426
 *
 * Verifies that importEvents does NOT write duplicate docs when:
 *   - stored events have Phase-2 org-prefixed _docId  (e.g. "acme_70055_2026...")
 *   - stored events have pre-Phase-2 un-prefixed _docId (e.g. "70055_2026...")
 *
 * Both forms must be recognised as duplicates when a CSV row with the raw
 * fingerprint (un-prefixed) is re-imported.
 *
 * Also asserts that a genuinely new row IS written (written === 1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React from 'react';

// ── Stubs ─────────────────────────────────────────────────────────────────────

const mockBatchSet = vi.fn();
const mockBatchCommit = vi.fn(() => Promise.resolve());
const mockWriteBatch = vi.fn(() => ({
  set: mockBatchSet,
  delete: vi.fn(),
  commit: mockBatchCommit,
}));

vi.mock('firebase/firestore', () => ({
  collection:      vi.fn(),
  doc:             vi.fn((db, col, id) => ({ id })),
  writeBatch:      (...a) => mockWriteBatch(...a),
  getDocs:         vi.fn(() => Promise.resolve({ empty: true, docs: [] })),
  query:           vi.fn(),
  where:           vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
}));

vi.mock('../../lib/firebase.js', () => ({
  db:   {},
  auth: { currentUser: { uid: 'u1' } },
}));

vi.mock('../../utils/firestoreWrite.js', () => ({
  safeWrite: vi.fn(async (writer) => { await writer(); return { ok: true }; }),
}));

vi.mock('../../utils/orgDocId.js', () => ({
  orgDocId: vi.fn((orgId, id) => `${orgId}_${id}`),
}));

vi.mock('../../lib/supabase.js', () => ({
  dualWriteSupabase:    vi.fn(() => Promise.resolve()),
  DATA_LAYER:           'firestore',
  isSupabaseConfigured: false,
  supabase:             null,
}));

vi.mock('../../utils/classifyEventType.js', () => ({
  classifyEventType: vi.fn(() => 'available'),
}));

// OrgContext
vi.mock('../OrgContext.jsx', () => ({
  useOrg: () => ({ orgId: 'acme' }),
}));

// useOrgTable — returns a configurable set of stored events.
let storedEvents = [];
vi.mock('../../hooks/useSupabaseTable.js', () => ({
  useOrgTable: vi.fn(() => ({
    items:    storedEvents,
    loading:  false,
    error:    null,
    loadMore: vi.fn(),
    hasMore:  false,
  })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { TelemetryProvider, useTelemetry } from '../TelemetryContext.jsx';

// Consumer that exposes importEvents for direct invocation in tests.
let importEventsRef = null;
function Consumer() {
  const { importEvents } = useTelemetry();
  importEventsRef = importEvents;
  return null;
}

function setup() {
  importEventsRef = null;
  render(
    <TelemetryProvider>
      <Consumer />
    </TelemetryProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  storedEvents = [];
  importEventsRef = null;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TelemetryContext dedup (bug #426)', () => {
  it('does NOT write when all input rows match Phase-2 org-prefixed stored docs', async () => {
    // Phase-2 stored docs: _docId has the org prefix.
    storedEvents = [
      { _docId: 'acme_70055_2026-01-01T100000_Available', scooterId: '70055', afterState: 'Available' },
      { _docId: 'acme_70055_2026-01-02T110000_InUse',     scooterId: '70055', afterState: 'InUse' },
    ];
    setup();
    await waitFor(() => expect(importEventsRef).not.toBeNull());

    // Parser emits raw (un-prefixed) fingerprints.
    const parsedEvents = [
      { _docId: '70055_2026-01-01T100000_Available', scooterId: '70055', afterState: 'Available' },
      { _docId: '70055_2026-01-02T110000_InUse',     scooterId: '70055', afterState: 'InUse' },
    ];

    let result;
    await act(async () => {
      result = await importEventsRef(parsedEvents);
    });

    expect(result.written).toBe(0);
    expect(result.duplicates).toBe(2);
    expect(mockBatchSet).not.toHaveBeenCalled();
  });

  it('does NOT write when all input rows match pre-Phase-2 un-prefixed stored docs', async () => {
    // Legacy stored docs: _docId has NO org prefix.
    storedEvents = [
      { _docId: '70055_2026-01-01T100000_Available', scooterId: '70055', afterState: 'Available' },
      { _docId: '70055_2026-01-02T110000_InUse',     scooterId: '70055', afterState: 'InUse' },
    ];
    setup();
    await waitFor(() => expect(importEventsRef).not.toBeNull());

    const parsedEvents = [
      { _docId: '70055_2026-01-01T100000_Available', scooterId: '70055', afterState: 'Available' },
      { _docId: '70055_2026-01-02T110000_InUse',     scooterId: '70055', afterState: 'InUse' },
    ];

    let result;
    await act(async () => {
      result = await importEventsRef(parsedEvents);
    });

    expect(result.written).toBe(0);
    expect(result.duplicates).toBe(2);
    expect(mockBatchSet).not.toHaveBeenCalled();
  });

  it('writes exactly 1 new row when only one event is genuinely new (mixed stored docs)', async () => {
    // Mix of Phase-2 prefixed and legacy un-prefixed stored docs.
    storedEvents = [
      { _docId: 'acme_70055_2026-01-01T100000_Available', scooterId: '70055', afterState: 'Available' },
      { _docId: '70055_2026-01-02T110000_InUse',          scooterId: '70055', afterState: 'InUse' },
    ];
    setup();
    await waitFor(() => expect(importEventsRef).not.toBeNull());

    // Two duplicates + one brand-new event.
    const parsedEvents = [
      { _docId: '70055_2026-01-01T100000_Available', scooterId: '70055', afterState: 'Available' },  // dup (Phase-2)
      { _docId: '70055_2026-01-02T110000_InUse',     scooterId: '70055', afterState: 'InUse' },       // dup (legacy)
      { _docId: '70055_2026-01-03T120000_Charging',  scooterId: '70055', afterState: 'Charging' },    // new
    ];

    let result;
    await act(async () => {
      result = await importEventsRef(parsedEvents);
    });

    expect(result.written).toBe(1);
    expect(result.duplicates).toBe(2);
    expect(mockBatchSet).toHaveBeenCalledTimes(1);
  });
});
