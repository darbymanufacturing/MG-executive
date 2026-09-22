/**
 * api/cron-daily-brief.js — Vercel Cron handler for daily brief generation.
 * Scheduled: 05:00 UTC daily (≈ 07:00 Athens EET / 08:00 EEST)
 *
 * Current status: STILL A SKELETON — it acknowledges and returns. The brief only
 * exists if someone opens Home that day (DailyBrief.jsx generates it client-side).
 *
 * Correction (2026-09-22): the old note here said activation was blocked on
 * installing firebase-admin. That is stale — `_lib/firebase-admin.js` is live
 * (the purge + parity crons use it) and identity moved to Supabase (ADR-0023).
 * What is actually missing is server-side payload aggregation: `_daily-brief.js`
 * only NARRATES a payload the client computes (`buildBriefPayload`), so a real
 * fan-out means porting that aggregation to the server — money-math work that
 * belongs in its own pass (docs/AUTOMATION_PLAN.md, Phase 4).
 *
 * Deliberately NO heartbeat ping here (#691): this handler returns 200 while
 * doing nothing, so pinging would report a dead pipeline as healthy — exactly
 * the false signal the heartbeat design exists to avoid. Wire
 * HEARTBEAT_DAILY_BRIEF when the fan-out actually ships.
 *
 * Keeping the cron scheduled is still useful: it is a second daily touch on the
 * deployment, and its schedule is already correct for when the fan-out lands.
 */

import { requireCronOrUser } from './_lib/require-auth.js';

export default async function handler(req, res) {
  /* Vercel calls crons with GET — allow GET only from Vercel's cron system */
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // #16 — cron secret OR an admin/staff user. (Was CRON_SECRET-only, which silently
  // allowed ANY caller whenever CRON_SECRET happened to be unset.)
  const auth = await requireCronOrUser(req, res);
  if (!auth) return;

  const date = new Date().toISOString().slice(0, 10);
  console.log(`[cron-daily-brief] Triggered for date: ${date}`);

  const isManual = auth.trigger === 'manual';
  const force    = req.query.force === '1';

  if (isManual && !force) {
    // TODO (when firebase-admin is live): query for any brief with today's date
    // const snapshot = await db.collection('briefs')
    //   .where('date', '==', date).limit(1).get();
    // if (!snapshot.empty) {
    //   return res.status(200).json({ ok: true, skipped: true,
    //     reason: 'Briefs already generated today. Add ?force=1 to override.' });
    // }
  }

  /* TODO: Fan-out when firebase-admin is available.
   * For each user, check existence of briefs/{date}_{uid} and skip if present
   * (idempotency). Track anthropicCalls in dailyCosts/{date} and cap at
   * users.docs.length + 5 to prevent runaway cost.
   *
   * const admin = initFirebaseAdmin();
   * const db = admin.firestore();
   * const users = await db.collection('users')
   *   .where('role', 'in', ['admin', 'staff']).get();
   * let anthropicCalls = 0;
   * const MAX_CALLS = users.docs.length + 5;
   * for (const userDoc of users.docs) {
   *   const existing = await db.collection('briefs').doc(`${date}_${userDoc.id}`).get();
   *   if (existing.exists && !force) continue;          // idempotency skip
   *   if (anthropicCalls >= MAX_CALLS) break;           // cost cap
   *   const data = await aggregateOperationalData(db, userDoc.id);
   *   const brief = await generateBrief(date, userDoc.id, data);
   *   await db.collection('briefs').doc(`${date}_${userDoc.id}`).set(brief);
   *   anthropicCalls++;
   * }
   */

  return res.status(200).json({
    ok: true,
    date,
    stub: true,
    message: 'Daily brief cron acknowledged. Client-side generation is active; server-side fan-out is Phase 4 of docs/AUTOMATION_PLAN.md (needs payload aggregation ported server-side).',
  });
}
