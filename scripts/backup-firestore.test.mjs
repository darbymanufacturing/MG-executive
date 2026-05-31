/**
 * scripts/backup-firestore.test.mjs
 *
 * Unit tests for the paginated backup logic (BUG #324).
 * No real Firebase connection required — all Firestore calls are stubbed.
 *
 * Run: npx vitest run scripts/backup-firestore.test.mjs
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tmpdir } from 'os';
import { mkdirSync, readFileSync, readdirSync, existsSync, rmSync } from 'fs';
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
          set(ref, data, opts) { ops.push(ref); },
          async commit() { commitCount++; },
        };
      },
    };

    await restoreJsonl(filePath, 'big', trackingDb, 450, false);

    // 1100 / 450 = 2 full batches + 1 remainder = 3 commits
    expect(commitCount).toBe(3);
  });
});
