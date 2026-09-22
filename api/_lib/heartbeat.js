/**
 * api/_lib/heartbeat.js — dead-man's-switch pings for scheduled jobs (#691).
 *
 * Why: every automated pipeline this app has ever had died SILENTLY —
 * the GitHub crons 401'd 110 times in a row, the hopp-sync worker wedged for
 * two days, and Supabase auto-paused because nothing was touching it. The
 * common failure is not "the job errored", it is "nobody noticed".
 *
 * An external monitor (Healthchecks.io free tier) expects a ping on a schedule
 * and alerts the owner when one does not arrive. That flips the failure mode
 * from silent-forever to noisy-within-hours.
 *
 * Rules this module follows:
 *   - Ping only on VERIFIED success. `/api/cron-daily-brief` returns HTTP 200
 *     while doing nothing, so "the handler returned 200" is not a signal;
 *     callers decide what success means and call ok() explicitly.
 *   - Never throw, never block the job. A monitoring outage must not fail a
 *     working cron, so every error is swallowed and logged.
 *   - No-op when the env var is unset, so this is inert until the owner
 *     creates the (free) checks and pastes the URLs into Vercel.
 *
 * Env vars (all optional, set in Vercel → Settings → Environment Variables):
 *   HEARTBEAT_KEEPALIVE          — api/_cron-keepalive.js
 *   HEARTBEAT_PURGE_ORGS         — api/_cron-purge-deleted-orgs.js
 *   HEARTBEAT_PARITY_CHECK       — api/_cron-supabase-parity-check.js
 *   HEARTBEAT_DAILY_BRIEF        — api/_cron-daily-brief.js
 * See docs/AUTOMATION_PLAN.md §6 and docs/runbooks/ for wiring.
 */

const TIMEOUT_MS = 5000;

/**
 * Send one heartbeat ping.
 *
 * @param {string} envVar   name of the env var holding the check URL
 * @param {object} [opts]
 * @param {'ok'|'fail'|'start'} [opts.signal='ok']  which endpoint to hit
 * @param {string} [opts.body]  short diagnostic body (Healthchecks stores it)
 * @returns {Promise<boolean>} true when the monitor acknowledged the ping
 */
export async function heartbeat(envVar, opts = {}) {
  const base = process.env[envVar];
  if (!base) return false; // not configured — inert by design

  const { signal = 'ok', body = '' } = opts;
  const url =
    signal === 'ok' ? base : `${base.replace(/\/$/, '')}/${signal}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      body: typeof body === 'string' ? body.slice(0, 2000) : '',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[heartbeat] ${envVar} responded ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    // Monitoring must never break the job it monitors.
    console.warn(`[heartbeat] ${envVar} ping failed: ${err?.message || err}`);
    return false;
  }
}

/** Convenience: ping success. */
export const heartbeatOk = (envVar, body) => heartbeat(envVar, { signal: 'ok', body });

/** Convenience: ping failure, so the monitor alerts immediately instead of waiting for a miss. */
export const heartbeatFail = (envVar, body) => heartbeat(envVar, { signal: 'fail', body });
