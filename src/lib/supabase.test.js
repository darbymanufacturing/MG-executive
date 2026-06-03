/**
 * Unit tests for the accessToken hook in the supabase.js createClient options.
 * BUG #383 regression: the hook must re-throw when currentUser exists but
 * getIdToken() rejects, so useSupabaseTable's catch block can toast + capture.
 *
 * Strategy: mock @supabase/supabase-js so createClient captures its options,
 * mock firebase.js auth to control currentUser, and mock @sentry/react to
 * assert captureException calls. Re-import supabase.js after stubbing env vars
 * so isSupabaseConfigured is true and createClient is actually called.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// --- capture the options passed to createClient ---
let capturedOptions = null;

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url, _key, options) => {
    capturedOptions = options;
    return { from: vi.fn() }; // minimal stub
  },
}));

// --- controllable auth mock ---
const mockGetIdToken = vi.fn();
const mockAuth = { currentUser: null };

vi.mock('./firebase.js', () => ({
  auth: mockAuth,
}));

// --- capture Sentry calls ---
const mockCaptureException = vi.fn();
vi.mock('@sentry/react', () => ({
  captureException: (...args) => mockCaptureException(...args),
}));

// --- stub remaining imports that supabase.js needs ---
vi.mock('./supabaseRowMap.js', () => ({
  toSupabaseRow: vi.fn(),
  SUPABASE_TABLE: {},
}));

vi.mock('./dataLayerConfig.js', () => ({
  GLOBAL_DATA_LAYER: 'supabase',
}));

// Stub env vars so isSupabaseConfigured → true and createClient is called.
vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
vi.resetModules();

// Import the module after all mocks are in place so createClient runs and
// capturedOptions is populated.
await import('./supabase.js');

afterEach(() => {
  vi.clearAllMocks();
  // Reset currentUser to null so each test starts from a known state.
  mockAuth.currentUser = null;
});

describe('accessToken hook (BUG-383)', () => {
  it('(1) returns null without throwing when auth.currentUser is null', async () => {
    mockAuth.currentUser = null;
    const result = await capturedOptions.accessToken();
    expect(result).toBeNull();
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('(2) returns the token string when currentUser exists and getIdToken() resolves', async () => {
    mockGetIdToken.mockResolvedValueOnce('firebase-id-token-xyz');
    mockAuth.currentUser = { getIdToken: mockGetIdToken };

    const result = await capturedOptions.accessToken();

    expect(result).toBe('firebase-id-token-xyz');
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('(3) re-throws and calls Sentry.captureException when currentUser exists but getIdToken() rejects', async () => {
    const tokenError = new Error('Token fetch failed: network offline');
    mockGetIdToken.mockRejectedValueOnce(tokenError);
    mockAuth.currentUser = { getIdToken: mockGetIdToken };

    await expect(capturedOptions.accessToken()).rejects.toThrow('Token fetch failed: network offline');
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(
      tokenError,
      { tags: { source: 'accessToken' } },
    );
  });
});
