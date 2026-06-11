import { requireUser } from './_lib/require-auth.js';

// On-demand Hopp sync: auth-gated proxy to the always-on hopp-sync worker's
// /sync/trigger. The worker owns auth/rotation against Hopp and writes runs to
// Supabase hopp_sync_runs; this endpoint just forwards the kick and relays the
// result. Runtime timeout governed by api/[...path].js config.maxDuration=60.
const UPSTREAM_TIMEOUT_MS = 55_000; // abort before Vercel's 60s kill so we can still respond

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const authUser = await requireUser(req, res, { roles: ['admin', 'staff', 'owner'] });
  if (!authUser) return;
  const token = process.env.MCP_BEARER_TOKEN;
  if (!token) return res.status(503).json({ ok: false, error: 'MCP_BEARER_TOKEN not configured' });
  const base = (process.env.HOPP_SYNC_URL || 'https://130-162-246-48.sslip.io').replace(/\/+$/, '');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(`${base}/sync/trigger`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    const body = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      return res.status(502).json({ ok: false, error: body?.error || `Sync worker responded ${upstream.status}` });
    }
    // Worker returns {ok, counts, errors, window} or {skipped:true} — pass through verbatim.
    return res.status(200).json(body ?? { ok: false, error: 'Empty response from sync worker' });
  } catch (err) {
    if (err?.name === 'AbortError') {
      // Run is still going on the worker; it finishes + logs to hopp_sync_runs on its own.
      return res.status(202).json({ ok: true, pending: true, message: 'sync still running — check the Hopp panel' });
    }
    return res.status(504).json({ ok: false, error: `Sync worker unreachable: ${err?.message || err}` });
  } finally {
    clearTimeout(timer);
  }
}
