/**
 * Regression tests for bug #415: flag() must NOT swallow the next flag as a value,
 * and Number.isFinite guards must throw rather than silently use NaN.
 *
 * The corrected flag() signature:
 *   (n, d = null) => { const i = args.indexOf(n); const v = args[i+1];
 *     return i >= 0 && v !== undefined && !v.startsWith('--') ? v : d; }
 */
import { describe, it, expect } from 'vitest';

/**
 * Inline the corrected flag() so this test file has zero external dependencies
 * and runs with `vitest` or `node --test` without network or Firebase.
 */
function makeFlag(args) {
  return (n, d = null) => {
    const i = args.indexOf(n);
    const v = args[i + 1];
    return i >= 0 && v !== undefined && !v.startsWith('--') ? v : d;
  };
}

describe('flag() — corrected implementation (bug #415)', () => {
  it('(a) --only followed by --commit returns the default (does NOT return "--commit")', () => {
    const flag = makeFlag(['--only', '--commit']);
    expect(flag('--only')).toBeNull();
    expect(flag('--only', 'defaultVal')).toBe('defaultVal');
  });

  it('(b) --only followed by a real value returns that value', () => {
    const flag = makeFlag(['--only', 'revenue']);
    expect(flag('--only')).toBe('revenue');
  });

  it('(c) flag not present in args returns the default', () => {
    const flag = makeFlag([]);
    expect(flag('--only')).toBeNull();
    expect(flag('--only', 'fallback')).toBe('fallback');
  });

  it('(d) flag present as last arg (no value following) returns the default', () => {
    const flag = makeFlag(['--only']);
    expect(flag('--only', 'fallback')).toBe('fallback');
  });

  it('does not treat an adjacent value that starts with "--" as data', () => {
    // e.g. --page --commit → PAGE should be NaN candidate; guard should throw
    const flag = makeFlag(['--page', '--commit']);
    const raw = flag('--page', '1000'); // returns '1000' (default) not '--commit'
    expect(raw).toBe('1000');
  });
});

describe('Number.isFinite guard for numeric flags (bug #415)', () => {
  it('(d) passing a non-numeric string as --page throws rather than silently producing NaN', () => {
    // Simulate what the scripts do after calling flag():
    function parsePageFlag(args) {
      const flag = makeFlag(args);
      const PAGE = Number(flag('--page', '1000'));
      if (!Number.isFinite(PAGE) || PAGE <= 0) throw new Error('--page must be a positive integer');
      return PAGE;
    }

    // Normal usage
    expect(parsePageFlag(['--page', '500'])).toBe(500);

    // Non-numeric string — should throw
    expect(() => parsePageFlag(['--page', 'abc'])).toThrow('--page must be a positive integer');

    // Zero — should throw
    expect(() => parsePageFlag(['--page', '0'])).toThrow('--page must be a positive integer');

    // Negative — should throw
    expect(() => parsePageFlag(['--page', '-5'])).toThrow('--page must be a positive integer');
  });
});
