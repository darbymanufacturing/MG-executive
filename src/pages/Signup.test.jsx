/**
 * Signup.jsx — rollback regression tests (bug-427).
 *
 * Verifies that on any failure after Auth user creation, both the org doc
 * (if written) and the Auth user are deleted so the same email can retry.
 *
 * Note on vi.mock hoisting: factory functions passed to vi.mock() are hoisted
 * to the top of the file before any variable declarations, so they cannot
 * reference variables declared with let/const. All mocks below use vi.fn()
 * inline. We grab references to the mocked functions via importd modules after
 * the mock registrations complete.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Mocks (factories must be self-contained — no outer variable refs) ────────

vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(),
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  collection: vi.fn(),
  serverTimestamp: vi.fn(() => '__SERVER_TS__'),
}));

vi.mock('../lib/firebase.js', () => ({
  db: { __db: true },
  // auth.currentUser is read at call time in the catch block, so we expose
  // a static object whose .delete is a vi.fn we can spy on.
  auth: {
    currentUser: {
      uid: 'test-uid-123',
      delete: vi.fn(() => Promise.resolve()),
    },
  },
}));

vi.mock('../utils/firestoreWrite.js', () => ({
  safeWrite: vi.fn(async (writer, opts) => {
    try {
      const data = await writer();
      return { ok: true, data };
    } catch (err) {
      if (opts?.rethrow) throw err;
      return { ok: false, error: err };
    }
  }),
}));

vi.mock('../components/Shared/AsterismMark.jsx', () => ({
  default: () => <span data-testid="asterism" />,
}));

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: vi.fn(),
}));

vi.mock('./Login.module.css', () => ({
  default: new Proxy({}, { get: (_t, k) => k }),
}));

// ── Import mocked modules to spy on their exports ───────────────────────────
import { useNavigate } from 'react-router-dom';
import { doc, setDoc, deleteDoc, collection } from 'firebase/firestore';
import { auth } from '../lib/firebase.js';
import { useAuth } from '../context/AuthContext.jsx';
import Signup from './Signup.jsx';

// ── Helpers ─────────────────────────────────────────────────────────────────

function renderSignup() {
  return render(<Signup />);
}

async function fillAndSubmit() {
  fireEvent.change(screen.getByPlaceholderText('Alex Papadopoulos'), {
    target: { value: 'Test User' },
  });
  fireEvent.change(screen.getByPlaceholderText('Acme Mobility'), {
    target: { value: 'Test Org' },
  });
  fireEvent.change(screen.getByPlaceholderText('you@company.com'), {
    target: { value: 'test@example.com' },
  });
  fireEvent.change(screen.getByPlaceholderText('At least 6 characters'), {
    target: { value: 'password123' },
  });
  fireEvent.click(screen.getByRole('button', { name: /create organization/i }));
}

// ── Setup ────────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
const mockSignUp = vi.fn();
const mockSyncClaims = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();

  useNavigate.mockReturnValue(mockNavigate);
  useAuth.mockReturnValue({ signUp: mockSignUp, syncClaims: mockSyncClaims });

  // doc(collection(db, 'organizations')) → object with .id for org auto-id path.
  // doc(db, 'organizations', id) → object for named-id path (rollback deleteDoc).
  collection.mockReturnValue({ __ref: 'collection' });
  doc.mockImplementation((_db, colOrRef, id) => ({
    __ref: 'doc',
    col: typeof colOrRef === 'string' ? colOrRef : 'organizations',
    id: id ?? 'auto-org-id-999',
  }));
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Signup — (1) happy path', () => {
  it('navigates to /onboarding and never calls deleteDoc or currentUser.delete', async () => {
    mockSignUp.mockResolvedValue();
    setDoc.mockResolvedValue();
    mockSyncClaims.mockResolvedValue();

    renderSignup();
    await fillAndSubmit();

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/onboarding', { replace: true })
    );
    expect(deleteDoc).not.toHaveBeenCalled();
    expect(auth.currentUser.delete).not.toHaveBeenCalled();
  });
});

describe('Signup — (2) org-write failure', () => {
  it('calls currentUser.delete (not deleteDoc) when org setDoc fails', async () => {
    mockSignUp.mockResolvedValue();
    // Org write fails; profile write never happens.
    setDoc.mockRejectedValueOnce(new Error('Firestore unavailable'));

    renderSignup();
    await fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByText(/firestore unavailable/i)).toBeInTheDocument()
    );

    // Org doc never committed → no deleteDoc
    expect(deleteDoc).not.toHaveBeenCalled();
    // Auth user was created → must be deleted
    expect(auth.currentUser.delete).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('Signup — (3) profile-write failure', () => {
  it('calls deleteDoc for org AND currentUser.delete when profile setDoc fails', async () => {
    mockSignUp.mockResolvedValue();
    // First setDoc = org (succeeds), second = profile (fails).
    setDoc
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('Profile write failed'));

    renderSignup();
    await fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByText(/profile write failed/i)).toBeInTheDocument()
    );

    // Org doc was committed → must be rolled back
    expect(deleteDoc).toHaveBeenCalledTimes(1);
    const deletedRef = deleteDoc.mock.calls[0][0];
    expect(deletedRef.col).toBe('organizations');

    // Auth user must also be rolled back
    expect(auth.currentUser.delete).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('Signup — (4) syncClaims failure', () => {
  it('calls deleteDoc for org AND currentUser.delete when syncClaims rejects', async () => {
    mockSignUp.mockResolvedValue();
    setDoc.mockResolvedValue(); // both org + profile writes succeed
    mockSyncClaims.mockRejectedValue(new Error('Claims sync failed'));

    renderSignup();
    await fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByText(/claims sync failed/i)).toBeInTheDocument()
    );

    // Org doc was committed → must be rolled back
    expect(deleteDoc).toHaveBeenCalledTimes(1);
    const deletedRef = deleteDoc.mock.calls[0][0];
    expect(deletedRef.col).toBe('organizations');

    // Auth user must also be rolled back
    expect(auth.currentUser.delete).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
