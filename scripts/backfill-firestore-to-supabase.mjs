#!/usr/bin/env node
/**
 * backfill-firestore-to-supabase.mjs — one-time historical copy of the five
 * time-series collections from Firestore into Supabase Postgres (ADR-0013).
 *
 * Modeled on scripts/backfill-org-id.mjs: dry-run by DEFAULT, idempotent, resumable.
 * Idempotency key = `source_doc_id` (the Firestore document id) with
 * `ON CONFLICT (source_doc_id) DO NOTHING`, so re-running never duplicates.
 *
 *   Reads  (Firestore admin):  FIREBASE_SERVICE_ACCOUNT_KEY (JSON) | GOOGLE_APPLICATION_CREDENTIALS (path)
 *   Writes (Supabase):         SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY  (service role bypasses RLS — server only)
 *
 * Usage (from scooter-fleet-costs/):
 *   node scripts/backfill-firestore-to-supabase.mjs                 # dry run, all 5 collections
 *   node scripts/backfill-firestore-to-supabase.mjs --commit        # write
 *   node scripts/backfill-firestore-to-supabase.mjs --only revenue,scooterTrips --commit
 *   node scripts/backfill-firestore-to-supabase.mjs --org-id mg-executive-org --commit
 *
 * --org-id sets the org_id for docs that don't yet carry an `orgId` field (the
 * Milestone B stamp may not have run in prod). It MUST equal the production org's
 * id / the `orgId` custom claim, or RLS will hide the rows from the app.
 */
import admin from 'firebase-admin';
import { createClient } from '@supabase/supabase-js';

// ── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const flag = (name, def = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const DEFAULT_ORG_ID = flag('--org-id', 'mg-executive-org');
const ONLY = (flag('--only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const PAGE = Number(flag('--page', '1000'));

// Firestore collection → Supabase table + a doc→row mapper.
// `data` carries the COMPLETE original doc (camelCase); typed columns are a
// queryable subset. source_doc_id = the Firestore document id.
const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const PLAN = {
  telemetryEvents: {
    table: 'telemetry_events',
    map: (d) => ({
      scooter_id: d.scooterId ?? null,
      event_ts: d.timestamp ?? null,
      before_state: d.beforeState ?? null,
      after_state: d.afterState ?? null,
      reason: d.reason ?? null,
      event_type: d.eventType ?? null,
      city: d.city ?? null,
      battery_level: num(d.batteryLevel),
    }),
  },
  scooterTrips: {
    table: 'scooter_trips',
    map: (d) => ({
      scooter_id: d.scooterId ?? null,
      started_at: d.startedAt ?? null,
      ended_at: d.endedAt ?? null,
      duration_minutes: num(d.durationMinutes),
      distance_km: num(d.distanceKm),
      cost: num(d.cost),
      is_paid: typeof d.isPaid === 'boolean' ? d.isPaid : null,
      city: d.city ?? null,
    }),
  },
  sprEvents: {
    table: 'spr_events',
    map: (d) => ({
      scooter_id: d.scooterId ?? null,
      datetime: d.datetime ?? null,
      city: d.city ?? null,
      zone: d.zone ?? null,
      lat: num(d.lat),
      lon: num(d.lon),
      after_state: d.afterState ?? null,
      action: d.action ?? null,
    }),
  },
  sprWeather: {
    table: 'spr_weather',
    map: (d) => ({ weather_date: d.date ?? null, city: d.city ?? null }),
  },
  revenue: {
    table: 'revenue_days',
    map: (d) => ({
      revenue_date: d.date ?? null,
      location: d.location ?? null,
      total_paid_revenue: num(d.totalPaidRevenue),
      total_trips: num(d.totalTrips),
      unique_users_count: num(d.uniqueUsersCount),
      unique_vehicles_count: num(d.uniqueVehiclesCount),
    }),
  },
};

// ── clients ───────────────────────────────────────────────────────────────────
function initFirestore() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (raw) {
      admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({ credential: admin.credential.applicationDefault() });
    } else {
      throw new Error('Set FIREBASE_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS.');
    }
  }
  return admin.firestore();
}

function initSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  return createClient(url, key, { auth: { persistSession: false } });
}

// JSON-safe deep clean: Firestore Timestamps → ISO, drop undefined.
function clean(value) {
  if (value === null || value === undefined) return null;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(clean);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = clean(v);
    }
    return out;
  }
  return value;
}

async function backfillCollection(db, sb, name) {
  const { table, map } = PLAN[name];
  const snap = await db.collection(name).get(); // one read/doc against Spark quota
  const total = snap.size;
  let written = 0;
  let buffer = [];

  const flush = async () => {
    if (!buffer.length) return;
    if (COMMIT) {
      const { error } = await sb.from(table).upsert(buffer, {
        onConflict: 'source_doc_id',
        ignoreDuplicates: true,
      });
      if (error) throw new Error(`[${name}→${table}] upsert failed: ${error.message}`);
    }
    written += buffer.length;
    buffer = [];
  };

  for (const doc of snap.docs) {
    const d = clean(doc.data()) ?? {};
    const row = {
      org_id: d.orgId || DEFAULT_ORG_ID,
      source_doc_id: doc.id,
      ...map(d),
      data: d,
    };
    buffer.push(row);
    if (buffer.length >= PAGE) await flush();
  }
  await flush();
  return { name, table, total, written };
}

// ── main ───────────────────────────────────────────────────────────────────────
async function main() {
  const names = (ONLY.length ? ONLY : Object.keys(PLAN)).filter((n) => {
    if (!PLAN[n]) { console.warn(`⚠️  unknown collection "${n}" — skipping`); return false; }
    return true;
  });

  console.log(`\n${COMMIT ? '🔴 COMMIT' : '🟢 DRY RUN'} — Firestore → Supabase backfill`);
  console.log(`   org_id fallback: ${DEFAULT_ORG_ID}`);
  console.log(`   collections:     ${names.join(', ')}\n`);

  const db = initFirestore();
  const sb = COMMIT ? initSupabase() : null;
  if (COMMIT && !sb) return;

  const report = [];
  for (const name of names) {
    process.stdout.write(`   ${name} … `);
    const r = await backfillCollection(db, COMMIT ? sb : { from: () => ({ upsert: async () => ({ error: null }) }) }, name);
    report.push(r);
    console.log(`${r.total} docs → ${COMMIT ? `${r.written} upserted` : `${r.total} WOULD upsert`} into ${r.table}`);
  }

  const grand = report.reduce((s, r) => s + r.total, 0);
  console.log(`\n${COMMIT ? '✅ committed' : '🟢 dry run'} — ${grand} total docs across ${report.length} collections.`);
  if (!COMMIT) console.log('   Re-run with --commit to write. Idempotent (ON CONFLICT source_doc_id DO NOTHING).');
  console.log(`   (Read ~${grand} Firestore docs against the Spark 50K/day quota.)\n`);
}

main().catch((e) => { console.error('\n❌', e.message); process.exit(1); });
