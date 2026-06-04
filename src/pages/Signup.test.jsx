/**
 * Signup.jsx — rollback regression tests (bug-427).
 *
 * Verifies that on any failure after Auth user creation the Auth user is
 * deleted so the same email can retry. ADR-0023: org + profile writes are
 * server-side (POST /api/signup); client-side Firestore writes no longer occur.
 *
 * Note on vi.mock hoisting: factory functions passed to vi.mock() are hoisted
 * to the top of the file before any variable declarations, so they cannot
 * reference variables declared with let/const. All mocks below use vi.fn()
 * inline. We grab references to the mocked functions via imported modules after
 * the mock registrations complete.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Mocks (factories must be self-contained — no outer variable refs) ────────

vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(),
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}));

vi.mock('../lib/firebase.js', () => ({
  db: { __db: true },
  // auth.currentUser is read at call time in the catch block, so we expose
  // a static object whose methods are vi.fn()s we can spy on.
  auth: {
    currentUser: {
      uid: 'test-uid-123',
      getIdToken: vi.fn(() => Promise.resolve('test-id-token')),
      delete: vi.fn(() => Promise.resolve()),
    },
  },
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

  // Default: fetch succeeds (POST /api/signup returns 200).
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  );
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Signup — (1) happy path', () => {
  it('navigates to /onboarding and never calls currentUser.delete', async () => {
    mockSignUp.mockResolvedValue();
    mockSyncClaims.mockResolvedValue();

    renderSignup();
    await fillAndSubmit();

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/onboarding', { replace: true })
    );
    expect(auth.currentUser.delete).not.toHaveBeenCalled();
  });
});

describe('Signup — (2) server signup failure (org/profile not created)', () => {
  it('calls currentUser.delete when POST /api/signup returns an error', async () => {
    mockSignUp.mockResolvedValue();
    // Server rejects the signup request (org + profile not written).
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ error: 'Firestore unavailable' }),
      })
    );

    renderSignup();
    await fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByText(/firestore unavailable/i)).toBeInTheDocument()
    );

    // Auth user was created → must be deleted so email isn't locked
    expect(auth.currentUser.delete).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('Signup — (3) server signup network error', () => {
  it('calls currentUser.delete when fetch rejects (network error)', async () => {
    mockSignUp.mockResolvedValue();
    // Network-level failure — org + profile not written server-side.
    global.fetch = vi.fn(() => Promise.reject(new Error('Profile write failed')));

    renderSignup();
    await fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByText(/profile write failed/i)).toBeInTheDocument()
    );

    // Auth user must be rolled back
    expect(auth.currentUser.delete).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('Signup — (4) syncClaims failure', () => {
  it('rolls back auth user when syncClaims rejects', async () => {
    mockSignUp.mockResolvedValue();
    // Server writes succeeded; claim refresh fails.
    mockSyncClaims.mockRejectedValue(new Error('Claims sync failed'));

    renderSignup();
    await fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByText(/claims sync failed/i)).toBeInTheDocument()
    );

    // Auth user must be rolled back (server-side data is cleaned up by the server)
    expect(auth.currentUser.delete).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
