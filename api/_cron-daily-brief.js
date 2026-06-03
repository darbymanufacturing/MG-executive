/**
 * api/cron-daily-brief.js — Vercel Cron handler for daily brief generation.
 * Scheduled: 05:00 UTC daily (≈ 07:00 Athens EET / 08:00 EEST)
 *
 * Current status: skeleton. Full implementation requires firebase-admin to
 * read user list and operational data server-side. For now, the daily brief
 * is generated client-side when the user opens the app (DailyBrief.jsx).
 *
 * To fully activate:
 *   1. npm install firebase-admin
 *   2. Add FIREBASE_SERVICE_ACCOUNT_KEY env var in Vercel (JSON string of service account)
 *   3. Replace the stub below with the actual fan-out logic
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
    message: 'Daily brief cron acknowledged. Client-side generation is active; server-side fan-out pending firebase-admin setup.',
  });
}
