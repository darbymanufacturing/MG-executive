/**
 * Regression tests for the private_key newline normalisation in firebase-admin.js.
 * Bug #357: Vercel env-var pasting turns real newlines into literal \n sequences,
 * causing `error:0909006C:PEM routines:get_name:no start line` at RSA signing time.
 *
 * firebase-admin (the npm package) is mocked so no real Firebase credentials are needed.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal fake PEM key shapes used across tests.
// ---------------------------------------------------------------------------

/** A realistic-looking private key with REAL newline characters. */
const REAL_NEWLINE_KEY =
  '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ==\n-----END PRIVATE KEY-----\n';

/** The same key but with literal two-character \n sequences instead of real newlines
 *  (what Vercel produces when pasting a JSON value via its env-var UI). */
const ESCAPED_KEY = REAL_NEWLINE_KEY.replace(/\n/g, '\\n');

/** Build a minimal service-account JSON object for a given private_key value. */
function makeServiceAccount(privateKey) {
  return {
    type: 'service_account',
    project_id: 'mg-executive',
    private_key_id: 'abc123',
    private_key: privateKey,
    client_email: 'test@mg-executive.iam.gserviceaccount.com',
    client_id: '1234567890',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
  };
}

// ---------------------------------------------------------------------------
// Mock firebase-admin BEFORE importing firebase-admin.js.
// ---------------------------------------------------------------------------

const mockInitializeApp = vi.fn();
const mockCert = vi.fn((creds) => ({ _creds: creds }));

vi.mock('firebase-admin', () => {
  const adminMock = {
    apps: [],
    initializeApp: mockInitializeApp,
    credential: { cert: mockCert },
    firestore: vi.fn(() => ({})),
    auth: vi.fn(() => ({})),
  };
  // Provide a default export as well (ESM interop).
  adminMock.default = adminMock;
  return { default: adminMock };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Set FIREBASE_SERVICE_ACCOUNT_KEY to the JSON of `serviceAccount`
 * and reset module state so each test gets a fresh `init()` call.
 */
async function loadModuleWith(serviceAccount) {
  process.env.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify(serviceAccount);

  // Reset module cache so _initialized = false and admin.apps = [] each time.
  vi.resetModules();

  // Re-import AFTER env var + module reset.
  return import('./firebase-admin.js');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('firebase-admin.js — private_key newline normalisation (bug #357)', () => {
  beforeEach(() => {
    mockInitializeApp.mockClear();
    mockCert.mockClear();
  });

  afterEach(() => {
    delete process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    vi.resetModules();
  });

  test('literal-\\n sequences are replaced with real newlines before initializeApp', async () => {
    const sa = makeServiceAccount(ESCAPED_KEY);
    // Sanity check: input must contain the problematic literal \n sequence.
    expect(sa.private_key).toContain('\\n');
    expect(sa.private_key).not.toContain('\n'.replace(/\n/, '\n'));

    const { getDb } = await loadModuleWith(sa);
    getDb(); // triggers init()

    // admin.credential.cert should have been called once.
    expect(mockCert).toHaveBeenCalledTimes(1);

    const passedCreds = mockCert.mock.calls[0][0];
    // After normalisation the key must contain real newlines, NOT literal \n.
    expect(passedCreds.private_key).toContain('\n');
    expect(passedCreds.private_key).not.toMatch(/\\n/);
    // And the PEM header must be present.
    expect(passedCreds.private_key).toContain('-----BEGIN PRIVATE KEY-----');

    expect(mockInitializeApp).toHaveBeenCalledTimes(1);
  });

  test('a key already containing real newlines passes through unchanged', async () => {
    const sa = makeServiceAccount(REAL_NEWLINE_KEY);
    // Sanity: must already have real newlines.
    expect(sa.private_key).toContain('\n');
    expect(sa.private_key).not.toMatch(/\\n/);

    const { getDb } = await loadModuleWith(sa);
    getDb();

    expect(mockCert).toHaveBeenCalledTimes(1);
    const passedCreds = mockCert.mock.calls[0][0];
    expect(passedCreds.private_key).toBe(REAL_NEWLINE_KEY);
    expect(mockInitializeApp).toHaveBeenCalledTimes(1);
  });

  test('key missing PEM header after substitution throws before initializeApp', async () => {
    // A key that contains literal \n sequences but whose content is garbage
    // (no -----BEGIN PRIVATE KEY----- header even after substitution).
    const badKey = 'not-a-valid-pem-at-all';
    const sa = makeServiceAccount(badKey);

    const { getDb } = await loadModuleWith(sa);

    expect(() => getDb()).toThrow(
      'FIREBASE_SERVICE_ACCOUNT_KEY private_key does not look like a valid PEM block'
    );
    // initializeApp must NOT have been called.
    expect(mockInitializeApp).not.toHaveBeenCalled();
  });
});
