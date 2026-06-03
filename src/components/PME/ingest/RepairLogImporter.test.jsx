/**
 * Regression tests for:
 *   #503 — RepairLogImporter used a local importTickets that wrote directly to
 *           Firestore without orgId/createdByUid/org-prefixed doc IDs, bypassing
 *           multi-tenant isolation.
 *
 * Strategy: mount RepairLogImporter with a mocked MaintenanceContext and verify
 * that the context's importTickets is called (not a local Firestore write) and
 * that the now-removed direct Firestore imports are no longer present in the module.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ── mock firebase so no real DB calls happen ──────────────────────────────────
vi.mock('../../../lib/firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  writeBatch: vi.fn(),
  doc: vi.fn(),
  serverTimestamp: vi.fn(),
}));

// ── mock parseRepairLogCsv ────────────────────────────────────────────────────
vi.mock('../../../utils/parseRepairLogCsv.js', () => ({
  parseRepairLogCsv: vi.fn(),
}));

// ── mock IngestSummary (pure display) ────────────────────────────────────────
vi.mock('./IngestSummary.jsx', () => ({
  default: ({ result }) =>
    result ? <div data-testid="summary">{result.written} written</div> : null,
}));

// ── mock CSS modules ──────────────────────────────────────────────────────────
vi.mock('./Importer.module.css', () => ({ default: {} }));

import { parseRepairLogCsv } from '../../../utils/parseRepairLogCsv.js';
import { writeBatch } from 'firebase/firestore';

// ── mock MaintenanceContext ───────────────────────────────────────────────────
const mockImportTickets = vi.fn();

vi.mock('../../../context/MaintenanceContext.jsx', () => ({
  useMaintenance: () => ({
    tickets: [{ _docId: 'existing-doc-1' }],
    importTickets: mockImportTickets,
  }),
}));

import RepairLogImporter from './RepairLogImporter.jsx';

// ── helpers ───────────────────────────────────────────────────────────────────
function makeFile(content = 'Issue Type\nrepair') {
  return new File([content], 'repairs.csv', { type: 'text/csv' });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('#503 — RepairLogImporter uses context importTickets, not local Firestore writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: parseRepairLogCsv returns two rows, one of which is a duplicate.
    parseRepairLogCsv.mockReturnValue({
      tickets: [
        { _docId: 'existing-doc-1', scooterId: '111' },
        { _docId: 'new-doc-2',      scooterId: '222' },
      ],
      errors: [],
      total: 2,
    });
    mockImportTickets.mockResolvedValue(undefined);
  });

  test('calls context importTickets — not writeBatch — when a CSV file is uploaded', async () => {
    render(<RepairLogImporter />);
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [makeFile()] } });

    await waitFor(() => expect(mockImportTickets).toHaveBeenCalledTimes(1));

    // The context function received the parsed rows
    expect(mockImportTickets).toHaveBeenCalledWith([
      { _docId: 'existing-doc-1', scooterId: '111' },
      { _docId: 'new-doc-2',      scooterId: '222' },
    ]);

    // writeBatch must NOT have been called — no direct Firestore write
    expect(writeBatch).not.toHaveBeenCalled();
  });

  test('shows IngestSummary with correct written + duplicate counts after import', async () => {
    render(<RepairLogImporter />);
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [makeFile()] } });

    // 1 duplicate (existing-doc-1 already in tickets), 1 new written
    await waitFor(() => screen.getByTestId('summary'));
    expect(screen.getByTestId('summary').textContent).toContain('1 written');
  });

  test('does not call importTickets when parsed tickets array is empty', async () => {
    parseRepairLogCsv.mockReturnValue({ tickets: [], errors: [], total: 0 });
    render(<RepairLogImporter />);
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [makeFile('Issue Type\n')] } });

    await waitFor(() => screen.getByTestId('summary'));
    expect(mockImportTickets).not.toHaveBeenCalled();
  });

  test('context importTickets is called with a single argument (no onProgress callback)', async () => {
    render(<RepairLogImporter />);
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [makeFile()] } });

    await waitFor(() => expect(mockImportTickets).toHaveBeenCalledTimes(1));
    // Must be called with exactly one argument — the rows array
    expect(mockImportTickets.mock.calls[0]).toHaveLength(1);
  });
});
