/**
 * scripts/restore-firestore.test.mjs
 *
 * Unit tests for arg-parsing (BUG #326) and manifest integrity checking (BUG #328).
 * No real Firebase connection required.
 *
 * Run: npx vitest run scripts/restore-firestore.test.mjs
 *
 * Note: --only arg-parsing tests run the script via child_process and assert
 * exit code / stderr (no Firebase creds needed since the guard fires before initAdmin).
 * Integrity-check tests inline the extracted logic to avoid the initAdmin barrier.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCRIPT = new URL('./restore-firestore.mjs', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

/**
 * Spawn the restore script with the given args.
 * Strips Firebase env vars so initAdmin fails fast if reached.
 */
function run(args) {
  const env = { ...process.env };
  delete env.FIREBASE_SERVICE_ACCOUNT_KEY;
  delete env.GOOGLE_APPLICATION_CREDENTIALS;
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env,
  });
  return {
    exitCode: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: (result.stdout || '') + (result.stderr || ''),
  };
}

/** Create a temporary backup dir. Returns dir path; caller is responsible for cleanup. */
function makeDir(manifestCollections = {}, files = {}) {
  const dir = join(tmpdir(), `restore-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '_manifest.json'), JSON.stringify({ format: 'json', collections: manifestCollections }));
  for (const [name, docs] of Object.entries(files)) {
    writeFileSync(join(dir, name), JSON.stringify(docs));
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Inline integrity-check logic (mirrors restore-firestore.mjs, no Firebase dep)
// ---------------------------------------------------------------------------

/**
 * Runs the same integrity-check logic as restore-firestore.mjs without initAdmin.
 * Returns { warnings, shouldAbort } so tests can assert on them directly.
 */
function checkIntegrity({ manifestCounts, collName, actualCount, commit }) {
  const warnings = [];
  let shouldAbort = false;
  const expected = manifestCounts[collName];
  if (expected !== undefined && actualCount !== expected) {
    warnings.push(`  ⚠️  ${collName}: manifest says ${expected} docs, backup file has ${actualCount} — backup may be truncated!`);
    if (commit) {
      shouldAbort = true;
    }
  }
  return { warnings, shouldAbort };
}

// ---------------------------------------------------------------------------
// BUG #326 — --only flag parsing (runs the real script; exits before initAdmin)
// ---------------------------------------------------------------------------

describe('BUG #326 — --only flag parsing', () => {
  it('--only=costs parses correctly — no "--only requires a value" error', () => {
    const dir = makeDir({ costs: 0 }, { 'costs.json': {} });
    const { combined } = run([dir, '--only=costs']);
    expect(combined).not.toContain('--only requires a value');
    rmSync(dir, { recursive: true, force: true });
  });

  it('--only costs parses correctly (space-separated) — no "--only requires a value" error', () => {
    const dir = makeDir({ costs: 0 }, { 'costs.json': {} });
    const { combined } = run([dir, '--only', 'costs']);
    expect(combined).not.toContain('--only requires a value');
    rmSync(dir, { recursive: true, force: true });
  });

  it('--only --commit exits with code 1 and prints usage error', () => {
    const dir = makeDir();
    const { exitCode, combined } = run([dir, '--only', '--commit']);
    expect(exitCode).toBe(1);
    expect(combined).toContain('--only requires a value');
    rmSync(dir, { recursive: true, force: true });
  });

  it('bare --only (no next arg) exits with code 1 and prints usage error', () => {
    const dir = makeDir();
    const { exitCode, combined } = run([dir, '--only']);
    expect(exitCode).toBe(1);
    expect(combined).toContain('--only requires a value');
    rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// BUG #328 — manifest doc-count integrity checking (inline logic, no Firebase)
// ---------------------------------------------------------------------------

describe('BUG #328 — manifest integrity check logic', () => {
  it('emits a warning when backup file has fewer docs than manifest records', () => {
    const { warnings } = checkIntegrity({
      manifestCounts: { costs: 5 },
      collName: 'costs',
      actualCount: 3,
      commit: false,
    });
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('manifest says 5');
    expect(warnings[0]).toContain('backup may be truncated');
  });

  it('sets shouldAbort=true when counts mismatch and commit=true', () => {
    const { shouldAbort } = checkIntegrity({
      manifestCounts: { costs: 5 },
      collName: 'costs',
      actualCount: 3,
      commit: true,
    });
    expect(shouldAbort).toBe(true);
  });

  it('does not set shouldAbort in dry-run mode even when counts mismatch', () => {
    const { shouldAbort, warnings } = checkIntegrity({
      manifestCounts: { costs: 5 },
      collName: 'costs',
      actualCount: 3,
      commit: false,
    });
    expect(shouldAbort).toBe(false);
    expect(warnings.length).toBe(1); // still warns
  });

  it('emits no warnings and does not abort when doc counts match (happy path)', () => {
    const { warnings, shouldAbort } = checkIntegrity({
      manifestCounts: { costs: 3 },
      collName: 'costs',
      actualCount: 3,
      commit: true,
    });
    expect(warnings.length).toBe(0);
    expect(shouldAbort).toBe(false);
  });

  it('emits no warnings when collection is absent from manifest (legacy backup)', () => {
    const { warnings, shouldAbort } = checkIntegrity({
      manifestCounts: {},
      collName: 'costs',
      actualCount: 3,
      commit: true,
    });
    expect(warnings.length).toBe(0);
    expect(shouldAbort).toBe(false);
  });
});
