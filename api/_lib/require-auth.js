/**
 * require-auth — shared serverless auth guard (#16/#17).
 *
 * Shared auth guard so every endpoint can enforce "a signed-in Firebase user
 * (optionally with an allowed role)" — or the Vercel cron secret — in one line.
 * Before this, 8 of 10 endpoints were publicly callable (anyone could spend
 * Anthropic $, hit the bank aggregator, or send email).
 *
 * Each helper RESPONDS with 401/403 and returns null on failure, so callers do:
 *   const user = await requireUser(req, res, { roles: ['admin', 'staff'] });
 *   if (!user) return;            // guard already sent the response
 *
 * Roles are read from the `user_role` custom claim stamped by sync-claim/signup/
 * create-user/accept-invite (ADR-0004 / ADR-0023). This avoids any Firestore or
 * Supabase round-trip and works for every user provisioned post-ADR-0023 cutover.
 */
import { timingSafeEqual } from 'node:crypto';
import { verifyIdToken } from './firebase-admin.js';

function readBearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

/** Read the RBAC role from the decoded JWT custom claim (no DB round-trip). */
function roleOf(decoded) {
  return decoded.user_role ?? null;
}

/**
 * Require a signed-in Firebase user. If `roles` is given, the `user_role` custom
 * claim on the JWT must be in it. Returns { uid, email, role } or null (after
 * sending 401/403).
 */
export async function requireUser(req, res, { roles } = {}) {
  const token = readBearer(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return null;
  }
  let decoded;
  try {
    decoded = await verifyIdToken(token);
  } catch {
    res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
    return null;
  }
  let role = null;
  if (roles && roles.length) {
    role = roleOf(decoded);
    if (!roles.includes(role)) {
      res.status(403).json({ error: 'You do not have permission to perform this action.' });
      return null;
    }
  }
  return { uid: decoded.uid, email: decoded.email ?? null, role };
}

/**
 * Allow EITHER the Vercel cron secret OR a signed-in user with an allowed role.
 * Returns { trigger: 'cron' | 'manual', uid, role } or null.
 */
export async function requireCronOrUser(req, res, { roles = ['admin', 'owner', 'staff'] } = {}) {
  const token = readBearer(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return null;
  }
  // Vercel sets x-vercel-cron: 1 on every scheduled invocation. External callers
  // (e.g. GitHub Actions) cannot set this header — Vercel infrastructure strips it
  // from inbound requests. We therefore support two CRON_SECRET paths:
  //   1. x-vercel-cron: 1 present → Vercel-native cron (CRON_SECRET must be configured).
  //   2. x-vercel-cron absent but a valid Bearer CRON_SECRET token present → external
  //      caller such as GitHub Actions (fixes #606 — GH Actions was always 401ing).
  const isCronCall = req.headers['x-vercel-cron'] === '1';
  if (isCronCall) {
    if (!process.env.CRON_SECRET) {
      console.error('[requireCronOrUser] CRON_SECRET env var is not configured — cron request rejected');
      res.status(503).json({ error: 'Server misconfiguration: CRON_SECRET not set.' });
      return null;
    }
    const a = Buffer.from(token);
    const b = Buffer.from(process.env.CRON_SECRET);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return { trigger: 'cron', uid: null, role: null };
    }
    // Secret present but token mismatch — fall through to user auth.
  }
  // External cron path (#606): no x-vercel-cron header but a valid CRON_SECRET Bearer
  // token means this is an authorised external scheduler (e.g. GitHub Actions).
  if (!isCronCall && process.env.CRON_SECRET) {
    const a = Buffer.from(token);
    const b = Buffer.from(process.env.CRON_SECRET);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return { trigger: 'cron', uid: null, role: null };
    }
  }
  const user = await requireUser(req, res, { roles });
  if (!user) return null; // requireUser already responded
  return { trigger: 'manual', uid: user.uid, role: user.role };
}
