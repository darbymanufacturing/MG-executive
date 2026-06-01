/**
 * Tests for the PII scrubber baked into initSentry's beforeSend callback.
 *
 * Strategy: mock @sentry/react so Sentry.init() captures its options object,
 * then force initSentry to run in "enabled" mode by setting the Vite env vars
 * that gate it. We then extract and exercise the beforeSend callback directly.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

// --- capture the options passed to Sentry.init ---
let capturedInit = null;

vi.mock('@sentry/react', () => ({
  init: (options) => { capturedInit = options; },
}));

// Stub Vite env vars so sentry.js sees them when it evaluates import.meta.env.
// vi.stubEnv propagates into imported modules; direct mutation of import.meta.env does not.
vi.stubEnv('VITE_SENTRY_DSN', 'https://fake@sentry.io/0');
vi.stubEnv('VITE_SENTRY_FORCE', 'true');

// Reset the module registry so sentry.js is re-evaluated fresh with the stubbed env.
vi.resetModules();

const { initSentry } = await import('./sentry.js');

beforeAll(async () => {
  await initSentry();
});

// Helper: run beforeSend with a deep-cloned event, return the result.
function runBeforeSend(event) {
  return capturedInit.beforeSend(JSON.parse(JSON.stringify(event)));
}

// ------------------------------------------------------------------
describe('sentry beforeSend PII scrubber', () => {
  it('(1) replaces email address in event.message', () => {
    const result = runBeforeSend({ message: 'user=john@example.com failed' });
    expect(result.message).toBe('user=[email] failed');
  });

  it('(2) replaces EUR amount in event.message', () => {
    const result = runBeforeSend({ message: 'charge of 12.50 EUR processed' });
    expect(result.message).toBe('charge of [amount] processed');
  });

  it('(2b) replaces EUR amount with euro-symbol prefix', () => {
    const result = runBeforeSend({ message: 'total: €1234.50' });
    expect(result.message).toContain('[amount]');
    expect(result.message).not.toContain('1234.50');
  });

  it('(3) replaces Firebase UID (28-char alphanumeric) in exception value', () => {
    const uid = 'AbCdEfGhIjKlMnOpQrStUvWxYz12'; // exactly 28 chars
    const result = runBeforeSend({
      exception: {
        values: [{ value: `Firestore permission denied for uid ${uid}` }],
      },
    });
    expect(result.exception.values[0].value).toBe(
      'Firestore permission denied for uid [uid]'
    );
  });

  it('(4) replaces Bearer token in breadcrumb message', () => {
    const result = runBeforeSend({
      breadcrumbs: {
        values: [{ message: 'Authorization: Bearer supersecrettoken123' }],
      },
    });
    expect(result.breadcrumbs.values[0].message).toBe(
      'Authorization: Bearer [token]'
    );
  });

  it('(5) passes a clean message through unchanged', () => {
    const result = runBeforeSend({ message: 'Network error: timeout after 5s' });
    expect(result.message).toBe('Network error: timeout after 5s');
  });

  it('(6) scrubs multiple PII types from the same message', () => {
    const uid = 'AbCdEfGhIjKlMnOpQrStUvWxYz12';
    const result = runBeforeSend({
      message: `user=admin@omni.gr uid=${uid} charged 99.99 EUR Bearer tok_abc`,
    });
    expect(result.message).not.toMatch(/admin@omni\.gr/);
    expect(result.message).not.toMatch(/AbCdEfGhIjKlMnOpQrStUvWxYz12/);
    expect(result.message).not.toMatch(/99\.99 EUR/);
    expect(result.message).not.toMatch(/Bearer tok_abc/);
    expect(result.message).toContain('[email]');
    expect(result.message).toContain('[uid]');
    expect(result.message).toContain('[amount]');
    expect(result.message).toContain('Bearer [token]');
  });

  it('(7) null/undefined/missing fields do not throw', () => {
    // Empty event — no fields at all
    expect(() => runBeforeSend({})).not.toThrow();

    // Null message, null exception value, undefined breadcrumb message
    expect(() =>
      runBeforeSend({
        message: null,
        exception: { values: [{ value: null }] },
        breadcrumbs: { values: [{ message: null }] },
      })
    ).not.toThrow();
  });

  it('returns the event (not null) so errors are still captured', () => {
    const result = runBeforeSend({ message: 'some error' });
    expect(result).not.toBeNull();
    expect(typeof result).toBe('object');
  });
});
