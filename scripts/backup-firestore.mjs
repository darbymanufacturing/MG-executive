/**
 * scripts/backup-firestore.mjs — On-demand full Firestore backup (Spark-compatible).
 *
 * Firestore's managed export (`gcloud firestore export`) requires the Blaze plan.
 * On Spark this script does the equivalent: reads every root collection via the
 * Admin SDK and writes one JSON file per collection to a timestamped folder,
 * plus a _manifest.json with per-collection counts.
 *
 * Credentials (one of):
 *   FIREBASE_SERVICE_ACCOUNT_KEY='<full service-account JSON string>'  (matches the cron)
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json       (standard ADC)
 *
 * Run:
 *   node scripts/backup-firestore.mjs
 *
 * Output: ./backups/firestore-YYYYMMDD-HHMMSS/<collection>.json (+ _manifest.json)
 *
 * ⚠️ Reads every doc once — on Spark this consumes ~(total doc count) of the
 *    50K/day read quota. Run sparingly. Restore with restore-firestore.mjs.
 *    Caveat: backs up ROOT collections only; this app stores nested data as
 *    arrays inside docs (not subcollections), so a flat backup is complete.
 *    If subcollections are ever added, extend this to recurse.
 */
import admin from 'firebase-admin';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

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

const pad = (n) => String(n).padStart(2, '0');

async function main() {
  initAdmin();
  const db = admin.firestore();
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const dir = resolve(process.cwd(), 'backups', `firestore-${stamp}`);
  mkdirSync(dir, { recursive: true });

  console.log(`Backing up to ${dir}\n`);
  const cols = await db.listCollections();
  const manifest = { createdAt: now.toISOString(), project: 'mg-executive', collections: {}, totalDocs: 0 };

  for (const col of cols) {
    const snap = await col.get();
    const docs = {};
    snap.forEach((d) => { docs[d.id] = encode(d.data()); });
    writeFileSync(resolve(dir, `${col.id}.json`), JSON.stringify(docs, null, 2));
    manifest.collections[col.id] = snap.size;
    manifest.totalDocs += snap.size;
    console.log(`  ${col.id.padEnd(24)} ${snap.size} docs`);
  }

  writeFileSync(resolve(dir, '_manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n✓ Backup complete: ${manifest.totalDocs} docs across ${cols.length} collections`);
  console.log(`  → ${dir}`);
  console.log(`  (consumed ~${manifest.totalDocs} Firestore reads against the Spark 50K/day quota)`);
  process.exit(0);
}

main().catch((e) => { console.error('Backup FAILED:', e.message); process.exit(1); });
