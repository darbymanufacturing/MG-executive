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
 *   node scripts/restore-firestore.mjs ./backups/firestore-YYYYMMDD-HHMMSS --commit     # WRITE
 *   node scripts/restore-firestore.mjs <dir> --commit --only costs,revenue              # subset
 *
 * Behaviour:
 *  - Restores via batched set() (BATCH_SIZE=450), preserving doc IDs → idempotent upsert.
 *  - ADDITIVE: it does NOT delete docs that exist in Firestore but not in the backup.
 *    (To fully reset a collection, clear it first — deliberately not automated here.)
 *  - Reverses the Timestamp/GeoPoint/DocumentReference encoding from the backup.
 */
import admin from 'firebase-admin';
import { readFileSync, readdirSync } from 'fs';
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
  const onlyArg = args.find((a) => a.startsWith('--only'));
  const only = onlyArg ? (onlyArg.split('=')[1] || args[args.indexOf(onlyArg) + 1] || '').split(',').filter(Boolean) : null;

  if (!dir) {
    console.error('Usage: node scripts/restore-firestore.mjs <backup-dir> [--commit] [--only col1,col2]');
    process.exit(1);
  }
  initAdmin();
  const db = admin.firestore();

  const files = readdirSync(resolve(dir)).filter((f) => f.endsWith('.json') && f !== '_manifest.json');
  const targets = only ? files.filter((f) => only.includes(basename(f, '.json'))) : files;

  console.log(`${commit ? '⚠️  COMMIT MODE — WILL WRITE' : 'DRY RUN — no writes'}  ·  source: ${dir}\n`);
  let grandTotal = 0;

  for (const file of targets) {
    const collName = basename(file, '.json');
    const docs = JSON.parse(readFileSync(resolve(dir, file), 'utf8'));
    const ids = Object.keys(docs);
    console.log(`  ${collName.padEnd(24)} ${ids.length} docs ${commit ? '→ writing' : '(would write)'}`);
    grandTotal += ids.length;

    if (!commit) continue;

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const id of ids.slice(i, i + BATCH_SIZE)) {
        batch.set(db.collection(collName).doc(id), decode(docs[id]));
      }
      await batch.commit();
    }
  }

  console.log(`\n${commit ? '✓ Restored' : 'Would restore'} ${grandTotal} docs across ${targets.length} collections.`);
  if (!commit) console.log('Re-run with --commit to actually write.');
  process.exit(0);
}

main().catch((e) => { console.error('Restore FAILED:', e.message); process.exit(1); });
