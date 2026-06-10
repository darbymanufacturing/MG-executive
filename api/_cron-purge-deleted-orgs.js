/**
 * api/cron-purge-deleted-orgs.js — daily cron that HARD-deletes organizations whose
 * grace period has elapsed (ROADMAP 2.6). The deferred, irreversible half of
 * api/delete-account.js: that endpoint only STAMPS organizations/{orgId}.deleteAt;
 * this cron does the actual cascade once `deleteAt <= now`.
 *
 * Trigger: Vercel cron (daily) via Authorization: Bearer ${CRON_SECRET}. An admin
 * may also invoke it manually (requireCronOrUser). Vercel Hobby = daily crons only.
 *
 * ADR-0023 Stage 1 migration:
 *   IDENTITY tables (organizations / users / invites) → Supabase (supabase-admin helpers).
 *   OPERATIONAL data tables (ORG_DATA_COLLECTIONS, UID_SCOPED_COLLECTIONS, config
 *   singletons) still read/write Firestore — these are stale rollback copies of the
 *   operational layer and will be cleaned up in Stage 3.
 *   // TODO(ADR-0023 Stage 3): remove Firestore ORG_DATA_COLLECTIONS / UID_SCOPED_COLLECTIONS /
 *   // CONFIG_SINGLETONS cascade when the operational data layer has been fully migrated to Supabase.
 *
 * For each org past its grace window:
 *   1. delete every org-scoped doc across all data collections (where orgId == org) [Firestore, Stage 3]
 *   2. delete the org's config/pow singletons (${orgId}_*) [Firestore, Stage 3]
 *   3. delete each member's users/{uid} Supabase identity row + Firebase Auth account [Supabase + Auth]
 *   4. delete invites for the org from Supabase [Supabase]
 *   5. delete the organizations/{orgId} Supabase identity row [Supabase]
 *
 * Idempotent + bounded: Firestore batch ops are batched at 450, capped per run so one cron
 * tick can't blow the Spark write quota. If an org has more Firestore docs than the cap,
 * it's partially purged and the next day's run continues (deleteAt stays set in Supabase
 * until the org row is finally removed).
 */
import { getDb, getAuth } from './_lib/firebase-admin.js';
import { requireCronOrUser } from './_lib/require-auth.js';
import {
  supabaseAdmin,
  sbGetDoc,
  sbGetByOrg,
  sbPatchDoc,
  sbDelDoc,
  sbDelByOrg,
} from './_lib/supabase-admin.js';

export const maxDuration = 60;

const BATCH_SIZE = 450;
// Spark free tier = 20k writes/day. Keep well under it so a purge can't starve the
// app's normal writes. Each deleted Firestore doc = 1 write.
const MAX_DELETES_PER_RUN = 5000;

// Every Firestore collection that carries an orgId field (mirrors the B3 conversion + B4 rules).
// TODO(ADR-0023 Stage 3): migrate these cascade deletes to Supabase operational tables.
const ORG_DATA_COLLECTIONS = [
  'costs', 'revenue', 'maintenanceTickets', 'maintenanceParts', 'scooters',
  'projects', 'decisionGates', 'brainstormIdeas', 'telemetryEvents',
  'scooterTrips', 'sprEvents', 'sprWeather', 'issues', 'repairProcedures',
  'repairSessions', 'pow_tasks', 'notifications', 'syncLogs',
];
// Firestore collections that store createdByUid instead of orgId (BUG #397/#400 — orgId was never
// stamped on these). Purged by querying createdByUid in memberUids.
// TODO(ADR-0023 Stage 3): migrate these cascade deletes to Supabase operational tables.
const UID_SCOPED_COLLECTIONS = ['briefs', 'bankTransactions'];
// Firestore org-scoped singleton config docs (composite ids ${orgId}_*).
// TODO(ADR-0023 Stage 3): migrate these cascade deletes to Supabase operational tables.
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

  // Supabase admin client (service-role, bypasses RLS).
  const supa = supabaseAdmin();
  if (!supa) {
    return res.status(500).json({ ok: false, error: 'Supabase admin client unavailable — check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars.' });
  }

  const db = getDb();
  const nowIso = new Date().toISOString();
  let deletesThisRun = 0;
  const report = [];

  try {
    // -----------------------------------------------------------------------
    // 1. Fetch due orgs from Supabase identity table.
    //    sbGetByOrg won't work here (we're filtering by deleteAt, not orgId).
    //    Fetch all org rows and filter in JS — the set of orgs pending purge is
    //    always small (bounded by how many were soft-deleted in the grace window).
    // -----------------------------------------------------------------------
    const { data: orgRows, error: orgFetchErr } = await supa
      .from('organizations')
      .select('source_doc_id, data');

    if (orgFetchErr) {
      throw new Error(`Failed to fetch organizations from Supabase: ${orgFetchErr.message}`);
    }

    const dueOrgs = (orgRows || []).filter(
      (row) => row.data?.deleteAt && row.data.deleteAt <= nowIso
    );

    if (dueOrgs.length === 0) {
      return res.status(200).json({ ok: true, purged: 0, message: 'No organizations due for purge.' });
    }

    for (const orgRow of dueOrgs) {
      if (deletesThisRun >= MAX_DELETES_PER_RUN) break;

      const orgId = orgRow.source_doc_id; // organizations: source_doc_id = orgId
      let orgDeletes = 0;
      let exhaustedBudget = false;

      // -----------------------------------------------------------------------
      // Re-verify deleteAt is still due (cancel-delete may have cleared it since
      // the initial query). Read the fresh row from Supabase.
      // -----------------------------------------------------------------------
      const freshDoc = await sbGetDoc('organizations', orgId);
      if (!freshDoc) continue; // already deleted by a concurrent run
      const freshDeleteAt = freshDoc.deleteAt;
      if (!freshDeleteAt || freshDeleteAt > nowIso) continue; // cancel-delete cleared or postponed it

      // Stamp purgeStartedAt so cancel-delete can refuse while purge is in flight.
      await sbPatchDoc('organizations', orgId, { purgeStartedAt: nowIso });

      // -----------------------------------------------------------------------
      // 2. Firestore ORG_DATA_COLLECTIONS cascade.
      // TODO(ADR-0023 Stage 3): replace with Supabase operational table deletes.
      // -----------------------------------------------------------------------
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
        await sbPatchDoc('organizations', orgId, { purgeStartedAt: null });
        report.push({ orgId, status: 'partial', deleted: orgDeletes });
        break; // resume next run; deleteAt stays set
      }

      // -----------------------------------------------------------------------
      // 3. Firestore UID-scoped collections (briefs, bankTransactions).
      //    Purge by createdByUid for every member of this org.
      //    Members are fetched from Supabase identity table (sbGetByOrg).
      //    TODO(ADR-0023 Stage 3): remove this block when operational tables migrate to Supabase.
      // -----------------------------------------------------------------------

      // Fetch all members for this org from Supabase identity table.
      // sbGetByOrg returns [{ _docId: uid, ...userData }].
      const memberRows = await sbGetByOrg('users', orgId);
      const memberUids = memberRows.map((m) => m._docId);

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
        await sbPatchDoc('organizations', orgId, { purgeStartedAt: null });
        report.push({ orgId, status: 'partial', deleted: orgDeletes });
        break;
      }

      // -----------------------------------------------------------------------
      // 4. Firestore config singletons.
      // TODO(ADR-0023 Stage 3): remove when operational config migrates to Supabase.
      // -----------------------------------------------------------------------
      const cfgBatch = db.batch();
      for (const [col, suffix] of CONFIG_SINGLETONS) {
        cfgBatch.delete(db.collection(col).doc(`${orgId}${suffix}`));
      }
      await cfgBatch.commit();
      deletesThisRun += CONFIG_SINGLETONS.length;

      // -----------------------------------------------------------------------
      // 5. Delete Supabase invites for the org.
      // -----------------------------------------------------------------------
      await sbDelByOrg('invites', orgId);

      // -----------------------------------------------------------------------
      // 6. Delete Supabase user identity rows for all members + Firebase Auth accounts.
      //    Supabase user rows: sbDelByOrg handles the bulk delete.
      //    Auth accounts: parallel deletes in chunks of 25 to avoid serial HTTP
      //    round-trips (BUG #457: 500 members × 200 ms ≈ 100 s > 60 s limit).
      // -----------------------------------------------------------------------
      await sbDelByOrg('users', orgId);
      deletesThisRun += memberUids.length;

      const AUTH_CONCURRENCY = 25;
      for (let i = 0; i < memberUids.length; i += AUTH_CONCURRENCY) {
        const chunk = memberUids.slice(i, i + AUTH_CONCURRENCY);
        await Promise.allSettled(
          chunk.map((uid) => getAuth().deleteUser(uid).catch(() => {}))
        );
      }

      // -----------------------------------------------------------------------
      // 7. Finally delete the org identity row from Supabase.
      // -----------------------------------------------------------------------
      await sbDelDoc('organizations', orgId);
      deletesThisRun += 1;
      report.push({ orgId, status: 'purged', deleted: orgDeletes + memberUids.length + 1 });
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
