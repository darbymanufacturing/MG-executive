/**
 * scripts/backup-firestore.mjs — On-demand full Firestore backup (Spark-compatible).
 *
 * Firestore's managed export (`gcloud firestore export`) requires the Blaze plan.
 * On Spark this script does the equivalent: reads every root collection via the
 * Admin SDK and writes one JSONL file per collection to a timestamped folder,
 * plus a _manifest.json with per-collection counts.
 *
 * Credentials (one of):
 *   FIREBASE_SERVICE_ACCOUNT_KEY='<full service-account JSON string>'  (matches the cron)
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json       (standard ADC)
 *
 * Run:
 *   node scripts/backup-firestore.mjs
 *
 * Output: ./backups/firestore-YYYYMMDD-HHMMSS/<collection>.jsonl (+ _manifest.json)
 *
 * ⚠️ Reads every doc once — on Spark this consumes ~(total doc count) of the
 *    50K/day read quota. Run sparingly. Restore with restore-firestore.mjs.
 *    Subcollections are detected automatically; if any are found the script
 *    aborts with a FATAL error (extend backupCollection() to recurse if needed).
 */
import admin from 'firebase-admin';
import { mkdirSync, writeFileSync, appendFileSync, renameSync, rmSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';

const PAGE_SIZE = 500;

// --skip <coll,coll> — exclude collections from the backup (e.g. the huge
// telemetryEvents when the Spark read quota is tight). Skipped collections are
// recorded in the manifest as { skipped: true } so the backup is self-describing.
//
// DEFAULT_SKIP: operational-progress subcollections that are not business data
// and that contain nested subcollections (backfill_state) — always excluded so the
// script never aborts FATAL on them regardless of --skip arguments.
const DEFAULT_SKIP = new Set(['backfill_state']);
const SKIP = (() => {
  const i = process.argv.indexOf('--skip');
  const cli = i >= 0 && process.argv[i + 1] ? new Set(process.argv[i + 1].split(',').map((s) => s.trim())) : new Set();
  return new Set([...DEFAULT_SKIP, ...cli]);
})();

function initAdmin() {
  if (admin.apps.length) return;
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (json) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(json)) });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp();
  } else {
    console.error('ERROR: set FIREBASE_SERVICE_ACCOUNT_KEY (JSON string) or GOOGLE_APPLICATION_CREDENTIALS (file path).');
    process.exit(1);
  }
}

// Firestore special types → JSON-safe, reversible shapes (see decode() in restore).
function encode(v) {
  if (v === null || v === undefined) return v;
  if (v instanceof admin.firestore.Timestamp) return { __fs: 'ts', seconds: v.seconds, nanoseconds: v.nanoseconds };
  if (v instanceof admin.firestore.GeoPoint) return { __fs: 'geo', latitude: v.latitude, longitude: v.longitude };
  if (v instanceof admin.firestore.DocumentReference) return { __fs: 'ref', path: v.path };
  if (Array.isArray(v)) return v.map(encode);
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = encode(v[k]);
    return o;
  }
  return v;
}

/**
 * Backup a single collection to a JSONL file using paginated reads.
 * Keeps memory flat at one page (~PAGE_SIZE docs) at a time.
 * Also checks each doc for subcollections and aborts if any are found
 * (extend this function with recursion if subcollections are ever added).
 */
async function backupCollection(col, dir, manifestCollections) {
  const filePath = resolve(dir, `${col.id}.jsonl`);
  let cursor = null;
  let count = 0;

  while (true) {
    let q = col.orderBy('__name__').limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const page = await q.get();
    if (page.empty) break;

    // Check for subcollections on each doc in this page — fail loud if found.
    for (const d of page.docs) {
      const subs = await d.ref.listCollections();
      if (subs.length) {
        console.error(`FATAL: subcollection detected under ${col.id}/${d.id} — extend backup script to recurse before running again.`);
        process.exit(1);
      }
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

const pad = (n) => String(n).padStart(2, '0');

async function main() {
  initAdmin();
  const db = admin.firestore();
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const dir = resolve(process.cwd(), 'backups', `firestore-${stamp}`);
  const tmpDir = dir + '.tmp';
  mkdirSync(tmpDir, { recursive: true });

  console.log(`Backing up to ${dir}\n`);
  const cols = await db.listCollections();
  const manifest = { createdAt: now.toISOString(), project: 'mg-executive', format: 'jsonl', collections: {}, totalDocs: 0 };

  if (SKIP.size) console.log(`(skipping: ${[...SKIP].join(', ')})\n`);
  for (const col of cols) {
    if (SKIP.has(col.id)) {
      manifest.collections[col.id] = { skipped: true };
      console.log(`  ${col.id.padEnd(24)} SKIPPED`);
      continue;
    }
    const count = await backupCollection(col, tmpDir, manifest.collections);
    manifest.totalDocs += count;
    console.log(`  ${col.id.padEnd(24)} ${count} docs`);
  }

  manifest.skipped = [...SKIP];
  writeFileSync(resolve(tmpDir, '_manifest.json'), JSON.stringify(manifest, null, 2));
  renameSync(tmpDir, dir);
  console.log(`\n✓ Backup complete: ${manifest.totalDocs} docs across ${cols.length} collections` + (SKIP.size ? ` (${SKIP.size} skipped)` : ''));
  console.log(`  → ${dir}`);
  console.log(`  (consumed ~${manifest.totalDocs} Firestore reads against the Spark 50K/day quota)`);
  process.exit(0);
}

main().catch((e) => {
  console.error('Backup FAILED:', e.message);
  const backupsDir = resolve(process.cwd(), 'backups');
  let cleaned = false;
  try {
    const entries = existsSync(backupsDir) ? readdirSync(backupsDir) : [];
    for (const entry of entries) {
      if (entry.endsWith('.tmp')) {
        const tmpPath = resolve(backupsDir, entry);
        const failedPath = tmpPath.replace(/\.tmp$/, '.FAILED');
        try {
          renameSync(tmpPath, failedPath);
          console.error(`Partial backup left at ${failedPath} — do not restore from it.`);
        } catch {
          rmSync(tmpPath, { recursive: true, force: true });
          console.error(`Partial backup at ${tmpPath} could not be renamed — deleted.`);
        }
        cleaned = true;
      }
    }
  } catch {
    console.error('Could not clean up partial backup directory.');
  }
  if (!cleaned) {
    console.error('No partial .tmp backup directory found to clean up.');
  }
  process.exit(1);
});
