/**
 * Regression tests for:
 *   #102 — removePhoto leaks deleted photos into Cloudinary forever
 *   #613 — cloudinary-delete accepts an arbitrary publicId with no org scoping
 *
 * Verifies that clicking the remove button on a thumb:
 *   (a) calls fetch('/api/cloudinary-delete') with the correct publicId derived
 *       from the Cloudinary secure_url of the removed photo — including orgId
 *       in the path prefix (repair-photos/<orgId>/<sessionId>/...).
 *   (b) calls onChange with only the remaining URLs (the removed URL is absent).
 *
 * Firebase auth is mocked to return a stub token. Fetch is mocked globally.
 * OrgContext is mocked to return a deterministic orgId.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────────

// Mock firebase.js auth export
vi.mock('../../lib/firebase.js', () => ({
  auth: {
    currentUser: {
      getIdToken: vi.fn().mockResolvedValue('stub-id-token'),
    },
  },
}));

// Mock OrgContext so the component can resolve orgId without a Provider tree
vi.mock('../../context/OrgContext.jsx', () => ({
  useOrg: vi.fn().mockReturnValue({ orgId: 'org-test-001' }),
}));

// Mock global fetch — we intercept all calls and capture them
let fetchCalls = [];
const fetchMock = vi.fn(async (url) => {
  fetchCalls.push(url);
  // Return a minimal OK response so the delete call does not throw
  return { ok: true, json: async () => ({ result: 'ok' }) };
});
vi.stubGlobal('fetch', fetchMock);

// ── Import component after mocks ───────────────────────────────────────────────
import PhotoUpload from './PhotoUpload.jsx';

// ── Helpers ────────────────────────────────────────────────────────────────────

// Two sample Cloudinary secure_url values using the org-scoped path format
// (repair-photos/<orgId>/<sessionId>/<step>-<timestamp>).
const ORG_ID  = 'org-test-001';
const URL_A = `https://res.cloudinary.com/mycloud/image/upload/v1234567890/repair-photos/${ORG_ID}/sess-1/1-1700000000000.jpg`;
const URL_B = `https://res.cloudinary.com/mycloud/image/upload/v1234567890/repair-photos/${ORG_ID}/sess-1/2-1700000000001.jpg`;

// Expected public_id extracted from URL_A:
//   split on '/upload/' → 'v1234567890/repair-photos/org-test-001/sess-1/1-1700000000000.jpg'
//   strip extension    → 'v1234567890/repair-photos/org-test-001/sess-1/1-1700000000000'
//   strip version      → 'repair-photos/org-test-001/sess-1/1-1700000000000'
const EXPECTED_PUBLIC_ID_A = `repair-photos/${ORG_ID}/sess-1/1-1700000000000`;

beforeEach(() => {
  fetchCalls = [];
  fetchMock.mockClear();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('#102 — removePhoto calls cloudinary-delete and filters onChange', () => {
  test('clicking remove on first thumb calls /api/cloudinary-delete with correct publicId', async () => {
    const onChange = vi.fn();

    render(
      <PhotoUpload
        sessionId="sess-1"
        stepNumber={1}
        photoUrls={[URL_A, URL_B]}
        onChange={onChange}
      />
    );

    // Find the remove buttons (aria-label="Remove photo") — first one is for URL_A
    const removeButtons = screen.getAllByLabelText('Remove photo');
    expect(removeButtons).toHaveLength(2);

    fireEvent.click(removeButtons[0]);

    // Wait for the async getIdToken + fetch call to fire
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/cloudinary-delete',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer stub-id-token',
          }),
          body: JSON.stringify({ publicId: EXPECTED_PUBLIC_ID_A }),
        })
      );
    });
  });

  test('clicking remove on first thumb calls onChange with only the second URL', async () => {
    const onChange = vi.fn();

    render(
      <PhotoUpload
        sessionId="sess-1"
        stepNumber={1}
        photoUrls={[URL_A, URL_B]}
        onChange={onChange}
      />
    );

    const removeButtons = screen.getAllByLabelText('Remove photo');
    fireEvent.click(removeButtons[0]);

    // onChange should be called immediately (does not await the delete fetch)
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([URL_B]);
    });
  });
});
