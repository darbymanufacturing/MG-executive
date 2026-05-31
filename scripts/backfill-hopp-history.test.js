/**
 * Regression tests for the parseArgs() logic in backfill-hopp-history.mjs.
 *
 * Guards BUG #318 (--max-writes NaN → quota guard silently disabled).
 *
 * parseArgs() is inlined here rather than imported because the source .mjs file
 * has a shebang and imports firebase-admin (a native Node module that is not
 * available in the vitest jsdom environment). The inline copy is kept intentionally
 * minimal — it exercises the exact logic added by the fix.
 *
 * If the production parseArgs() logic changes, update this copy and re-run.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// parseArgs() — inlined from backfill-hopp-history.mjs (BUG #318 fix)
// ---------------------------------------------------------------------------
function parseArgs(argv = []) {
  const COMMIT      = argv.includes('--commit');
  const RESET       = argv.includes('--reset');
  const ROLLUP_ONLY = argv.includes('--rollup-revenue');

  const onlyIdx = argv.indexOf('--only');
  const onlyVal = onlyIdx >= 0 ? argv[onlyIdx + 1] : undefined;
  const ONLY = (onlyVal && !onlyVal.startsWith('--')) ? onlyVal : null;

  const mwIdx = argv.indexOf('--max-writes');
  let MAX_WRITES = 15000;
  if (mwIdx >= 0) {
    const n = parseInt(argv[mwIdx + 1], 10);
    if (!Number.isFinite(n) || n <= 0) {
      // (warn would go here in production)
    } else {
      MAX_WRITES = n;
    }
  }

  return { COMMIT, RESET, ROLLUP_ONLY, ONLY, MAX_WRITES };
}

// ---------------------------------------------------------------------------
// --max-writes
// ---------------------------------------------------------------------------
describe('parseArgs() — --max-writes', () => {
  it('returns 15000 when --max-writes is absent', () => {
    expect(parseArgs([]).MAX_WRITES).toBe(15000);
  });

  it('returns 15000 when --max-writes is the last arg (value is undefined)', () => {
    expect(parseArgs(['--max-writes']).MAX_WRITES).toBe(15000);
  });

  it('returns 15000 when --max-writes is followed by another flag (missing value)', () => {
    expect(parseArgs(['--max-writes', '--commit']).MAX_WRITES).toBe(15000);
  });

  it('returns 500 when --max-writes 500 is supplied', () => {
    expect(parseArgs(['--max-writes', '500']).MAX_WRITES).toBe(500);
  });

  it('returns 15000 when --max-writes 0 is supplied (non-positive rejected)', () => {
    expect(parseArgs(['--max-writes', '0']).MAX_WRITES).toBe(15000);
  });

  it('returns 15000 when --max-writes -1 is supplied (negative rejected)', () => {
    expect(parseArgs(['--max-writes', '-1']).MAX_WRITES).toBe(15000);
  });

  it('returns 15000 when --max-writes has a non-numeric value', () => {
    expect(parseArgs(['--max-writes', 'abc']).MAX_WRITES).toBe(15000);
  });

  it('returns 18000 when --max-writes 18000 is combined with --commit', () => {
    const { MAX_WRITES, COMMIT } = parseArgs(['--commit', '--max-writes', '18000']);
    expect(MAX_WRITES).toBe(18000);
    expect(COMMIT).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// --only
// ---------------------------------------------------------------------------
describe('parseArgs() — --only', () => {
  it('returns null when --only is absent', () => {
    expect(parseArgs([]).ONLY).toBeNull();
  });

  it('returns null when --only is the last arg (no value)', () => {
    expect(parseArgs(['--only']).ONLY).toBeNull();
  });

  it('returns null when --only is followed by another flag (missing value)', () => {
    expect(parseArgs(['--only', '--commit']).ONLY).toBeNull();
  });

  it('returns the scooter code string when --only SC001 is supplied', () => {
    expect(parseArgs(['--only', 'SC001']).ONLY).toBe('SC001');
  });

  it('returns numeric scooter id as string when supplied', () => {
    expect(parseArgs(['--only', '54889']).ONLY).toBe('54889');
  });
});

// ---------------------------------------------------------------------------
// Boolean flags
// ---------------------------------------------------------------------------
describe('parseArgs() — boolean flags', () => {
  it('COMMIT defaults to false', () => {
    expect(parseArgs([]).COMMIT).toBe(false);
  });

  it('COMMIT is true when --commit is present', () => {
    expect(parseArgs(['--commit']).COMMIT).toBe(true);
  });

  it('RESET defaults to false', () => {
    expect(parseArgs([]).RESET).toBe(false);
  });

  it('RESET is true when --reset is present', () => {
    expect(parseArgs(['--reset']).RESET).toBe(true);
  });

  it('ROLLUP_ONLY defaults to false', () => {
    expect(parseArgs([]).ROLLUP_ONLY).toBe(false);
  });

  it('ROLLUP_ONLY is true when --rollup-revenue is present', () => {
    expect(parseArgs(['--rollup-revenue']).ROLLUP_ONLY).toBe(true);
  });
});
