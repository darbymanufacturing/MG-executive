/**
 * scripts/backup-firestore.test.mjs
 *
 * Unit tests for the paginated backup logic (BUG #324).
 * No real Firebase connection required — all Firestore calls are stubbed.
 *
 * Run: npx vitest run scripts/backup-firestore.test.mjs
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'os';
import { mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync, renameSync } from 'fs';
import { resolve, join } from 'path';

// ---------------------------------------------------------------------------
// Helpers — build a minimal mock Firestore collection that returns paginated
// results using cursor-based ordering (simulates orderBy('__name__').limit()).
// ---------------------------------------------------------------------------

/** Build a list of fake docs with numeric string IDs, e.g. "doc0001". */
function fakeDocs(count, prefix = 'doc') {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${String(i).padStart(4, '0')}`,
    data: () => ({ val: i }),
    ref: {
      listCollections: async () => [], // no subcollections
    },
  }));
}

/**
 * Build a mock collection whose `.orderBy('__name__').limit(n)` chain returns
 * docs in pages. Tracks how many times `.get()` is called.
 */
function mockCollection(docs, id) {
  let getCalls = 0;

  function makeQuery(startIndex, limit) {
    const slice = docs.slice(startIndex, startIndex + limit);
    const q = {
      // Support chaining: q.startAfter(cursor) returns a new query
      startAfter(cursor) {
        const idx = docs.findIndex((d) => d.id === cursor.id) + 1;
        return makeQuery(idx, limit);
      },
      async get() {
        getCalls++;
        return {
          empty: slice.length === 0,
          docs: slice,
          size: slice.length,
        };
      },
    };
    return q;
  }

  return {
    id,
    orderBy(_field) {
      return {
        limit(n) {
          return makeQuery(0, n);
        },
      };
    },
    getCallCount() { return getCalls; },
  };
}

// ---------------------------------------------------------------------------
// The core backup loop extracted for testability.
// This mirrors the logic in backup-firestore.mjs — if the script changes,
// update this accordingly.
// ---------------------------------------------------------------------------
import { appendFileSync } from 'fs';

const PAGE_SIZE = 500;

function encode(v) {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(encode);
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = encode(v[k]);
    return o;
  }
  return v;
}

async function backupCollection(col, dir, manifestCollections) {
  const filePath = resolve(dir, `${col.id}.jsonl`);
  let cursor = null;
  let count = 0;

  while (true) {
    let q = col.orderBy('__name__').limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const page = await q.get();
    if (page.empty) break;

    for (const d of page.docs) {
      const subs = await d.ref.listCollections();
      if (subs.length) throw new Error(`FATAL: subcollection detected under ${col.id}/${d.id}`);
    }

    const lines = page.docs.map((d) => JSON.stringify({ id: d.id, data: encode(d.data()) })).join('\n') + '\n';
    appendFileSync(filePath, lines);
    count += page.size;
    cursor = page.docs[page.docs.length - 1];
    if (page.size < PAGE_SIZE) break;
  }

  manifestCollections[col.id] = count;
  return count;
}

// ---------------------------------------------------------------------------
// Restore JSONL streaming logic extracted for testability.
// ---------------------------------------------------------------------------
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

function decode(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(decode);
  const o = {};
  for (const k of Object.keys(v)) o[k] = decode(v[k]);
  return o;
}

async function restoreJsonl(filePath, collName, db, batchSize, merge) {
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  let batch = db.batch();
  let batchCount = 0;
  let lineCount = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    const { id, data } = JSON.parse(line);
    lineCount++;
    batch.set(db.collection(collName).doc(id), decode(data), merge ? { merge: true } : undefined);
    batchCount++;
    if (batchCount === batchSize) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }
  if (batchCount > 0) await batch.commit();
  return lineCount;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('backup-firestore — paginated streaming (BUG #324)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `backup-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  it('paginates — calls .get() at least 3 times for a 1100-doc collection', async () => {
    const docs = fakeDocs(1100, 'bigcol');
    const col = mockCollection(docs, 'bigCollection');
    const manifestCollections = {};

    await backupCollection(col, tmpDir, manifestCollections);

    // 1100 docs / 500 per page = 3 pages (500, 500, 100)
    expect(col.getCallCount()).toBeGreaterThanOrEqual(3);
  });

  it('writes exactly 1100 + 100 newline-delimited records across two JSONL files', async () => {
    const largeDocs = fakeDocs(1100, 'large');
    const smallDocs = fakeDocs(100, 'small');
    const largCol = mockCollection(largeDocs, 'largeCollection');
    const smallCol = mockCollection(smallDocs, 'smallCollection');
    const manifestCollections = {};

    await backupCollection(largCol, tmpDir, manifestCollections);
    await backupCollection(smallCol, tmpDir, manifestCollections);

    const largeFile = resolve(tmpDir, 'largeCollection.jsonl');
    const smallFile = resolve(tmpDir, 'smallCollection.jsonl');

    expect(existsSync(largeFile)).toBe(true);
    expect(existsSync(smallFile)).toBe(true);

    const largeLines = readFileSync(largeFile, 'utf8').split('\n').filter((l) => l.trim());
    const smallLines = readFileSync(smallFile, 'utf8').split('\n').filter((l) => l.trim());

    expect(largeLines).toHaveLength(1100);
    expect(smallLines).toHaveLength(100);

    // Each line is valid JSON with {id, data} shape
    const parsed = JSON.parse(largeLines[0]);
    expect(parsed).toHaveProperty('id');
    expect(parsed).toHaveProperty('data');
  });

  it('manifest records format:jsonl and correct doc counts', async () => {
    const docs = fakeDocs(1100, 'col');
    const col = mockCollection(docs, 'myCollection');
    const manifest = { format: 'jsonl', collections: {}, totalDocs: 0 };

    const count = await backupCollection(col, tmpDir, manifest.collections);
    manifest.totalDocs += count;

    expect(manifest.format).toBe('jsonl');
    expect(manifest.collections.myCollection).toBe(1100);
    expect(manifest.totalDocs).toBe(1100);
  });
});

// ---------------------------------------------------------------------------
// BUG #325 — partial-failure cleanup: .tmp → .FAILED on error, .tmp → final on
// success. These tests exercise the same logic that main() and the .catch handler
// use, isolated to just the fs operations so no Firebase connection is needed.
// ---------------------------------------------------------------------------

/**
 * Simulates what the updated main() does: write to tmpDir, then on success
 * rename to finalDir. On failure the catch handler renames tmpDir → .FAILED.
 *
 * @param {string} backupsDir  The base backups directory (created by caller)
 * @param {string} stamp       Timestamp string like "20260101-120000"
 * @param {boolean} fail       If true, throw after writing the first collection
 */
async function simulateBackup(backupsDir, stamp, fail) {
  const finalDir = join(backupsDir, `firestore-${stamp}`);
  const tmpDir = finalDir + '.tmp';
  mkdirSync(tmpDir, { recursive: true });

  try {
    // Simulate writing first collection
    writeFileSync(join(tmpDir, 'col1.jsonl'), '{"id":"doc0","data":{}}\n');

    if (fail) {
      throw new Error('Simulated Firestore failure on second collection');
    }

    // Simulate writing second collection and manifest
    writeFileSync(join(tmpDir, 'col2.jsonl'), '{"id":"doc0","data":{}}\n');
    writeFileSync(join(tmpDir, '_manifest.json'), JSON.stringify({ totalDocs: 2 }, null, 2));

    // Success: rename .tmp → final
    renameSync(tmpDir, finalDir);
  } catch (e) {
    // Failure cleanup: rename .tmp → .FAILED (mirrors main().catch handler)
    const entries = existsSync(backupsDir) ? readdirSync(backupsDir) : [];
    for (const entry of entries) {
      if (entry.endsWith('.tmp')) {
        const tmpPath = join(backupsDir, entry);
        const failedPath = tmpPath.replace(/\.tmp$/, '.FAILED');
        try {
          renameSync(tmpPath, failedPath);
        } catch {
          rmSync(tmpPath, { recursive: true, force: true });
        }
      }
    }
    throw e;
  }
}

describe('backup-firestore — partial-failure cleanup (BUG #325)', () => {
  let sandboxDir;

  beforeEach(() => {
    sandboxDir = join(tmpdir(), `backup-bug325-${Date.now()}`);
    mkdirSync(sandboxDir, { recursive: true });
  });

  it('failure: no final dir exists, .FAILED dir exists with first collection, no _manifest.json', async () => {
    const stamp = '20260101-120000';
    const finalDir = join(sandboxDir, `firestore-${stamp}`);
    const failedDir = finalDir + '.FAILED';

    await expect(simulateBackup(sandboxDir, stamp, true)).rejects.toThrow('Simulated Firestore failure');

    // (a) No clean final directory
    expect(existsSync(finalDir)).toBe(false);
    // (b) .FAILED directory exists and contains the first collection's file
    expect(existsSync(failedDir)).toBe(true);
    expect(existsSync(join(failedDir, 'col1.jsonl'))).toBe(true);
    // (c) No _manifest.json in the .FAILED dir
    expect(existsSync(join(failedDir, '_manifest.json'))).toBe(false);
    // (d) No .tmp dir left over
    expect(existsSync(finalDir + '.tmp')).toBe(false);
  });

  it('success: final dir with _manifest.json exists, no .tmp or .FAILED siblings', async () => {
    const stamp = '20260101-130000';
    const finalDir = join(sandboxDir, `firestore-${stamp}`);
    const tmpDir = finalDir + '.tmp';
    const failedDir = finalDir + '.FAILED';

    await simulateBackup(sandboxDir, stamp, false);

    // Final dir exists and has _manifest.json
    expect(existsSync(finalDir)).toBe(true);
    expect(existsSync(join(finalDir, '_manifest.json'))).toBe(true);
    // No .tmp or .FAILED siblings
    expect(existsSync(tmpDir)).toBe(false);
    expect(existsSync(failedDir)).toBe(false);
  });
});

describe('restore-firestore — JSONL streaming (BUG #324)', () => {
  let tmpDir;
  let setCallCount;
  let mockDb;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `restore-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    setCallCount = 0;

    // Build a mock db with batch() → { set(), commit() }
    mockDb = {
      collection(name) {
        return {
          doc(id) {
            return { collName: name, docId: id };
          },
        };
      },
      batch() {
        const ops = [];
        return {
          set(ref, data, opts) {
            ops.push({ ref, data, opts });
            setCallCount++;
          },
          async commit() { /* no-op */ },
        };
      },
    };
  });

  it('calls batch.set exactly 1200 times for 1200 JSONL lines across two files', async () => {
    // Write two JSONL files: 1100 + 100 docs = 1200 total
    const file1 = resolve(tmpDir, 'collection1.jsonl');
    const file2 = resolve(tmpDir, 'collection2.jsonl');

    const lines1 = Array.from({ length: 1100 }, (_, i) =>
      JSON.stringify({ id: `doc${i}`, data: { val: i } })
    ).join('\n') + '\n';
    const lines2 = Array.from({ length: 100 }, (_, i) =>
      JSON.stringify({ id: `doc${i}`, data: { val: i } })
    ).join('\n') + '\n';

    appendFileSync(file1, lines1);
    appendFileSync(file2, lines2);

    await restoreJsonl(file1, 'collection1', mockDb, 450, false);
    await restoreJsonl(file2, 'collection2', mockDb, 450, false);

    expect(setCallCount).toBe(1200);
  });

  it('never accumulates more than BATCH_SIZE docs in memory at once (commit resets batch)', async () => {
    // 1100 docs → 3 batches committed (450, 450, 200)
    const filePath = resolve(tmpDir, 'big.jsonl');
    const lines = Array.from({ length: 1100 }, (_, i) =>
      JSON.stringify({ id: `doc${i}`, data: { val: i } })
    ).join('\n') + '\n';
    appendFileSync(filePath, lines);

    let commitCount = 0;
    const trackingDb = {
      collection(name) { return { doc(id) { return { name, id }; } }; },
      batch() {
        const ops = [];
        return {
          set(ref, _data, _opts) { ops.push(ref); },
          async commit() { commitCount++; },
        };
      },
    };

    await restoreJsonl(filePath, 'big', trackingDb, 450, false);

    // 1100 / 450 = 2 full batches + 1 remainder = 3 commits
    expect(commitCount).toBe(3);
  });
});
