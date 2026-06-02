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
  'repairSessions', 'pow_tasks', 'notifications', 'syncLogs',
];
// Collections that store createdByUid instead of orgId (BUG #397/#400 — orgId was never stamped
// on these). Purged by querying createdByUid in memberUids. Must be deleted separately.
const UID_SCOPED_COLLECTIONS = ['briefs', 'bankTransactions'];
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

      // Re-verify deleteAt is still due (cancel-delete may have cleared it since the initial query).
      const freshDoc = await orgDoc.ref.get();
      if (!freshDoc.exists) continue; // already deleted by a concurrent run
      const freshDeleteAt = freshDoc.data().deleteAt;
      if (!freshDeleteAt || freshDeleteAt > nowIso) continue; // cancel-delete cleared or postponed it

      // Stamp purgeStartedAt so cancel-delete can refuse while purge is in flight.
      await orgDoc.ref.update({ purgeStartedAt: nowIso });

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
        // Clear the in-flight stamp so cancel-delete can still act before the next cron tick.
        await orgDoc.ref.update({ purgeStartedAt: FieldValue.delete() });
        report.push({ orgId, status: 'partial', deleted: orgDeletes });
        break; // resume next run; deleteAt stays set
      }

      // 1b. UID-scoped collections (briefs, bankTransactions) — never received an orgId stamp
      //     (BUG #397/#400). Purge by createdByUid for every member of this org.
      //     Firestore `in` supports up to 30 items — chunk memberUids if needed.
      const membersForUidSnap = await db.collection('users').where('orgId', '==', orgId).get();
      const memberUids = membersForUidSnap.docs.map((d) => d.id);

      if (memberUids.length > 0) {
        // Split into groups of 30 (Firestore `in` limit).
        const UID_IN_LIMIT = 30;
        const uidChunks = [];
        for (let i = 0; i < memberUids.length; i += UID_IN_LIMIT) {
          uidChunks.push(memberUids.slice(i, i + UID_IN_LIMIT));
        }

        for (const col of UID_SCOPED_COLLECTIONS) {
          for (const chunk of uidChunks) {
            while (deletesThisRun < MAX_DELETES_PER_RUN) {
              const remaining = MAX_DELETES_PER_RUN - deletesThisRun;
              const pageSize = Math.min(BATCH_SIZE, remaining);
              const snap = await db.collection(col)
                .where('createdByUid', 'in', chunk)
                .limit(pageSize)
                .get();
              if (snap.empty) break;
              const batch = db.batch();
              snap.docs.forEach((d) => batch.delete(d.ref));
              await batch.commit();
              orgDeletes += snap.size;
              deletesThisRun += snap.size;
              if (snap.size < pageSize) break; // chunk drained
            }
            if (deletesThisRun >= MAX_DELETES_PER_RUN) { exhaustedBudget = true; break; }
          }
          if (exhaustedBudget) break;
        }
      }

      if (exhaustedBudget) {
        await orgDoc.ref.update({ purgeStartedAt: FieldValue.delete() });
        report.push({ orgId, status: 'partial', deleted: orgDeletes });
        break;
      }

      // 2. Config singletons.
      const cfgBatch = db.batch();
      for (const [col, suffix] of CONFIG_SINGLETONS) {
        cfgBatch.delete(db.collection(col).doc(`${orgId}${suffix}`));
      }
      await cfgBatch.commit();
      deletesThisRun += CONFIG_SINGLETONS.length;

      // 3. Members: users/{uid} docs + Auth accounts (reuse membersForUidSnap from step 1b).
      for (const m of membersForUidSnap.docs) {
        await m.ref.delete();
        await getAuth().deleteUser(m.id).catch(() => {}); // best-effort
        deletesThisRun += 1;
      }

      // 4. Finally the org doc itself.
      await orgDoc.ref.delete();
      deletesThisRun += 1;
      report.push({ orgId, status: 'purged', deleted: orgDeletes + membersForUidSnap.size + 1 });
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
    return res.status(500).json({ ok: false, error: 'Purge failed', report });
  }
}
