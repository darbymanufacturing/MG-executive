/**
 * api/cron-purge-deleted-orgs.js — daily cron that HARD-deletes organizations whose
 * grace period has elapsed (ROADMAP 2.6). The deferred, irreversible half of
 * api/delete-account.js: that endpoint only STAMPS organizations/{orgId}.deleteAt;
 * this cron does the actual cascade once `deleteAt <= now`.
 *
 * Trigger: Vercel cron (daily) via Authorization: Bearer ${CRON_SECRET}. An admin
 * may also invoke it manually (requireCronOrUser). Vercel Hobby = daily crons only.
 *
 * For each org past its grace window:
 *   1. delete every org-scoped doc across all data collections (where orgId == org)
 *   2. delete the org's config/pow singletons (${orgId}_*)
 *   3. delete each member's users/{uid} doc + Firebase Auth account
 *   4. delete the organizations/{orgId} doc itself
 *
 * Idempotent + bounded: batched at 450, capped per run so one cron tick can't blow the
 * Spark write quota. If an org has more docs than the cap, it's partially purged and the
 * next day's run continues (deleteAt stays set until the org doc is finally removed).
 */
import { getDb, getAuth, FieldValue } from './_lib/firebase-admin.js';
import { requireCronOrUser } from './_lib/require-auth.js';

export const maxDuration = 60;

const BATCH_SIZE = 450;
// Spark free tier = 20k writes/day. Keep well under it so a purge can't starve the
// app's normal writes. Each deleted doc = 1 write.
const MAX_DELETES_PER_RUN = 5000;

// Every collection that carries an orgId field (mirrors the B3 conversion + B4 rules).
const ORG_DATA_COLLECTIONS = [
  'costs', 'revenue', 'maintenanceTickets', 'maintenanceParts', 'scooters',
  'projects', 'decisionGates', 'brainstormIdeas', 'diary', 'telemetryEvents',
  'scooterTrips', 'sprEvents', 'sprWeather', 'issues', 'repairProcedures',
  'repairSessions', 'pow_tasks', 'notifications', 'briefs', 'syncLogs',
];
// Org-scoped singleton config docs (composite ids ${orgId}_*).
const CONFIG_SINGLETONS = [
  ['config', '_fleet'], ['config', '_scooters'], ['config', '_maintenance'], ['config', '_spr'],
  ['pow', '_config'],
];

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireCronOrUser(req, res, { roles: ['owner', 'admin'] });
  if (!auth) return;

  const db = getDb();
  const nowIso = new Date().toISOString();
  let deletesThisRun = 0;
  const report = [];

  try {
    // Orgs whose grace window has elapsed.
    const dueSnap = await db.collection('organizations')
      .where('deleteAt', '<=', nowIso)
      .get();

    if (dueSnap.empty) {
      return res.status(200).json({ ok: true, purged: 0, message: 'No organizations due for purge.' });
    }

    for (const orgDoc of dueSnap.docs) {
      if (deletesThisRun >= MAX_DELETES_PER_RUN) break;
      const orgId = orgDoc.id;
      let orgDeletes = 0;
      let exhaustedBudget = false;

      // 1. Org-scoped data collections.
      for (const col of ORG_DATA_COLLECTIONS) {
        while (deletesThisRun < MAX_DELETES_PER_RUN) {
          const remaining = MAX_DELETES_PER_RUN - deletesThisRun;
          const pageSize = Math.min(BATCH_SIZE, remaining);
          const snap = await db.collection(col)
            .where('orgId', '==', orgId)
            .limit(pageSize)
            .get();
          if (snap.empty) break;
          const batch = db.batch();
          snap.docs.forEach((d) => batch.delete(d.ref));
          await batch.commit();
          orgDeletes += snap.size;
          deletesThisRun += snap.size;
          if (snap.size < pageSize) break; // collection drained
        }
        if (deletesThisRun >= MAX_DELETES_PER_RUN) { exhaustedBudget = true; break; }
      }

      if (exhaustedBudget) {
        report.push({ orgId, status: 'partial', deleted: orgDeletes });
        break; // resume next run; deleteAt stays set
      }

      // 2. Config singletons.
      const cfgBatch = db.batch();
      for (const [col, suffix] of CONFIG_SINGLETONS) {
        cfgBatch.delete(db.collection(col).doc(`${orgId}${suffix}`));
      }
      await cfgBatch.commit();
      deletesThisRun += CONFIG_SINGLETONS.length;

      // 3. Members: users/{uid} docs + Auth accounts.
      const membersSnap = await db.collection('users').where('orgId', '==', orgId).get();
      for (const m of membersSnap.docs) {
        await m.ref.delete();
        await getAuth().deleteUser(m.id).catch(() => {}); // best-effort
        deletesThisRun += 1;
      }

      // 4. Finally the org doc itself.
      await orgDoc.ref.delete();
      deletesThisRun += 1;
      report.push({ orgId, status: 'purged', deleted: orgDeletes + membersSnap.size + 1 });
    }

    return res.status(200).json({
      ok: true,
      purged: report.filter((r) => r.status === 'purged').length,
      deletesThisRun,
      report,
      trigger: auth.trigger,
    });
  } catch (err) {
    console.error('cron-purge-deleted-orgs error:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Purge failed', report });
  }
}
