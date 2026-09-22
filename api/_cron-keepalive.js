/**
 * api/cron-keepalive.js — daily Supabase keep-alive + liveness probe (#691).
 *
 * WHY THIS EXISTS
 * Supabase's free tier pauses a project after ~7 days without traffic. On
 * 2026-09-07 that happened: the only jobs that ever touched the database were
 * the two GitHub-Actions crons, and those had been failing with 401 since
 * 2026-06-04 (no CRON_SECRET repo secret), while the one Vercel cron
 * (cron-daily-brief) is a stub that never queries anything. With zero traffic
 * the project paused, `AuthContext` could not read the user profile, and the
 * app showed "Account not provisioned" to its own owner (#692).
 *
 * This handler makes one cheap, real read every day. That is enough to keep the
 * project active, and — paired with a heartbeat — it doubles as the canary that
 * proves scheduling still works at all.
 *
 * Trigger: Vercel cron (daily, see vercel.json) with Authorization: Bearer
 * ${CRON_SECRET}; GitHub Actions calls it too as an independent second caller.
 * An admin can also hit it manually (requireCronOrUser).
 */
import { requireCronOrUser } from './_lib/require-auth.js';
import { supabaseAdmin } from './_lib/supabase-admin.js';
import { heartbeatOk, heartbeatFail } from './_lib/heartbeat.js';

const HEARTBEAT_ENV = 'HEARTBEAT_KEEPALIVE';

/* Probe the smallest identity table rather than an operational one: it is tiny,
 * always present, and a failure here is exactly the failure that locks users out. */
const PROBE_TABLE = 'organizations';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireCronOrUser(req, res);
  if (!auth) return;

  const startedAt = Date.now();

  let supabase;
  try {
    supabase = supabaseAdmin();
  } catch (err) {
    // Env vars missing — the job cannot do its one task, so alert loudly.
    const message = err?.message || String(err);
    console.error(`[cron-keepalive] supabase-admin unavailable: ${message}`);
    await heartbeatFail(HEARTBEAT_ENV, `supabase-admin unavailable: ${message}`);
    return res.status(503).json({ ok: false, error: 'Supabase admin client unavailable' });
  }

  const { error, count } = await supabase
    .from(PROBE_TABLE)
    .select('source_doc_id', { count: 'exact', head: true });

  const latencyMs = Date.now() - startedAt;

  if (error) {
    // A paused/unreachable project lands here — this is the alert we want.
    console.error(`[cron-keepalive] probe failed after ${latencyMs}ms: ${error.message}`);
    await heartbeatFail(HEARTBEAT_ENV, `probe failed (${latencyMs}ms): ${error.message}`);
    return res.status(502).json({ ok: false, table: PROBE_TABLE, latencyMs, error: error.message });
  }

  console.log(`[cron-keepalive] ok — ${PROBE_TABLE} reachable in ${latencyMs}ms (rows: ${count ?? 'n/a'})`);
  await heartbeatOk(HEARTBEAT_ENV, `ok ${latencyMs}ms rows=${count ?? 'n/a'}`);

  return res.status(200).json({
    ok: true,
    table: PROBE_TABLE,
    rows: count ?? null,
    latencyMs,
    trigger: auth.trigger,
    date: new Date().toISOString().slice(0, 10),
  });
}
