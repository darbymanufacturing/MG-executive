/**
 * scripts/restore-firestore.mjs — Restore a backup made by backup-firestore.mjs.
 *
 * DRY RUN BY DEFAULT — prints what it would write and changes nothing. You must
 * pass --commit to actually write. This is your "call it whenever" recovery path.
 *
 * Credentials: same as backup-firestore.mjs (FIREBASE_SERVICE_ACCOUNT_KEY or
 * GOOGLE_APPLICATION_CREDENTIALS).
 *
 * Run:
 *   node scripts/restore-firestore.mjs ./backups/firestore-YYYYMMDD-HHMMSS              # DRY RUN
 *   node scripts/restore-firestore.mjs ./backups/firestore-YYYYMMDD-HHMMSS --commit     # WRITE (full overwrite)
 *   node scripts/restore-firestore.mjs <dir> --commit --merge                           # WRITE (merge, preserve extra fields)
 *   node scripts/restore-firestore.mjs <dir> --commit --only costs,revenue              # subset
 *
 * Behaviour:
 *  - Restores via batched set() (BATCH_SIZE=450), preserving doc IDs → idempotent upsert.
 *  - REPLACE (default): existing docs are FULLY OVERWRITTEN with the backup version —
 *    any fields added after the backup date are silently lost.
 *    Pass --merge to use set({merge:true}) instead, which merges fields rather than
 *    replacing the whole doc (safer for partial restores; slower).
 *  - Does NOT delete docs that exist in Firestore but not in the backup
 *    (collection-level is additive — no collection wipe).
 *    To fully reset a collection, clear it first — deliberately not automated here.
 *  - Reverses the Timestamp/GeoPoint/DocumentReference encoding from the backup.
 *  - Supports both legacy .json format and the newer .jsonl (streaming) format.
 *    Format is detected from _manifest.json `format` field (absent = legacy json).
 */
import admin from 'firebase-admin';
import { readFileSync, readdirSync, createReadStream } from 'fs';
import { createInterface } from 'readline';
import { resolve, basename } from 'path';

const BATCH_SIZE = 450;

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

function decode(v) {
  if (v === null || typeof v !== 'object') return v;
  if (v.__fs === 'ts') return new admin.firestore.Timestamp(v.seconds, v.nanoseconds);
  if (v.__fs === 'geo') return new admin.firestore.GeoPoint(v.latitude, v.longitude);
  if (v.__fs === 'ref') return admin.firestore().doc(v.path);
  if (Array.isArray(v)) return v.map(decode);
  const o = {};
  for (const k of Object.keys(v)) o[k] = decode(v[k]);
  return o;
}

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  const commit = args.includes('--commit');
  const merge = args.includes('--merge');
  const onlyArg = args.find((a) => a.startsWith('--only'));
  let only = null;
  if (onlyArg) {
    const embedded = onlyArg.split('=')[1];          // --only=costs,revenue
    const nextArg  = args[args.indexOf(onlyArg) + 1]; // --only costs,revenue
    const raw = embedded ?? (nextArg && !nextArg.startsWith('--') ? nextArg : null);
    if (!raw) {
      console.error('ERROR: --only requires a value (e.g. --only costs,revenue or --only=costs,revenue).');
      process.exit(1);
    }
    only = raw.split(',').filter(Boolean);
  }

  if (!dir) {
    console.error('Usage: node scripts/restore-firestore.mjs <backup-dir> [--commit] [--merge] [--only col1,col2]');
    process.exit(1);
  }
  initAdmin();
  const db = admin.firestore();

  // Detect backup format from _manifest.json
  let manifestData = {};
  try { manifestData = JSON.parse(readFileSync(resolve(dir, '_manifest.json'), 'utf8')); } catch { /* no manifest — fall back to format detection */ }
  const isJsonl = manifestData.format === 'jsonl';
  const manifestCounts = manifestData.collections || {};

  const files = readdirSync(resolve(dir)).filter((f) =>
    (f.endsWith('.json') || f.endsWith('.jsonl')) && f !== '_manifest.json'
  );
  const targets = only
    ? files.filter((f) => only.includes(basename(f, isJsonl ? '.jsonl' : '.json')))
    : files;

  const modeLabel = commit
    ? (merge ? '⚠️  COMMIT MODE (MERGE) — WILL WRITE (set+merge)' : '⚠️  COMMIT MODE (REPLACE) — WILL OVERWRITE')
    : 'DRY RUN — no writes';
  console.log(`${modeLabel}  ·  source: ${dir}  ·  format: ${isJsonl ? 'jsonl' : 'json'}\n`);
  let grandTotal = 0;

  for (const file of targets) {
    const ext = isJsonl ? '.jsonl' : '.json';
    const collName = basename(file, ext);

    if (isJsonl) {
      // Streaming JSONL path — memory-flat, one batch at a time.
      // Count lines for the dry-run summary by streaming without writing.
      let lineCount = 0;

      if (commit) {
        const rl = createInterface({ input: createReadStream(resolve(dir, file)), crlfDelay: Infinity });
        let batch = db.batch();
        let batchCount = 0;
        for await (const line of rl) {
          if (!line.trim()) continue;
          const { id, data } = JSON.parse(line);
          lineCount++;
          batch.set(db.collection(collName).doc(id), decode(data), merge ? { merge: true } : undefined);
          batchCount++;
          if (batchCount === BATCH_SIZE) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
          }
        }
        if (batchCount > 0) await batch.commit();
      } else {
        // Dry run: stream and count only, no writes.
        const rl = createInterface({ input: createReadStream(resolve(dir, file)), crlfDelay: Infinity });
        for await (const line of rl) {
          if (!line.trim()) continue;
          lineCount++;
        }
      }

      const expectedJsonl = manifestCounts[collName];
      if (expectedJsonl !== undefined && lineCount !== expectedJsonl) {
        console.warn(`  ⚠️  ${collName}: manifest says ${expectedJsonl} docs, backup file has ${lineCount} — backup may be truncated!`);
        if (commit) { console.error('Aborting restore — pass --skip-integrity to force.'); process.exit(1); }
      }
      console.log(`  ${collName.padEnd(24)} ${lineCount} docs ${commit ? '→ written' : '(would write)'}`);
      grandTotal += lineCount;
    } else {
      // Legacy JSON path — backward compatible with all existing backups.
      const docs = JSON.parse(readFileSync(resolve(dir, file), 'utf8'));
      const ids = Object.keys(docs);
      const expectedJson = manifestCounts[collName];
      if (expectedJson !== undefined && ids.length !== expectedJson) {
        console.warn(`  ⚠️  ${collName}: manifest says ${expectedJson} docs, backup file has ${ids.length} — backup may be truncated!`);
        if (commit) { console.error('Aborting restore — pass --skip-integrity to force.'); process.exit(1); }
      }
      console.log(`  ${collName.padEnd(24)} ${ids.length} docs ${commit ? '→ writing' : '(would write)'}`);
      grandTotal += ids.length;

      if (!commit) continue;

      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const batch = db.batch();
        for (const id of ids.slice(i, i + BATCH_SIZE)) {
          batch.set(db.collection(collName).doc(id), decode(docs[id]), merge ? { merge: true } : undefined);
        }
        await batch.commit();
      }
    }
  }

  console.log(`\n${commit ? '✓ Restored' : 'Would restore'} ${grandTotal} docs across ${targets.length} collections.`);
  if (!commit) console.log('Re-run with --commit to actually write.');
  process.exit(0);
}

main().catch((e) => { console.error('Restore FAILED:', e.message); process.exit(1); });
