/**
 * require-auth — shared serverless auth guard (#16/#17).
 *
 * Generalizes the dual-auth at the top of cron-hopp-sync.js so every endpoint can
 * enforce "a signed-in Firebase user (optionally with an allowed role)" — or the
 * Vercel cron secret — in one line. Before this, 8 of 10 endpoints were publicly
 * callable (anyone could spend Anthropic $, hit the bank aggregator, or send email).
 *
 * Each helper RESPONDS with 401/403 and returns null on failure, so callers do:
 *   const user = await requireUser(req, res, { roles: ['admin', 'staff'] });
 *   if (!user) return;            // guard already sent the response
 *
 * Roles live in users/{uid}.role today (Phase 2 / ADR-0004 moves them to custom
 * claims so rules can authorize without a doc read).
 */
import { timingSafeEqual } from 'node:crypto';
import { getDb, verifyIdToken } from './firebase-admin.js';

function readBearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

async function roleOf(uid) {
  const snap = await getDb().collection('users').doc(uid).get();
  return snap.exists ? (snap.data().role ?? null) : null;
}

/**
 * Require a signed-in Firebase user. If `roles` is given, users/{uid}.role must be
 * in it. Returns { uid, email, role } or null (after sending 401/403).
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
    role = await roleOf(decoded.uid);
    if (!roles.includes(role)) {
      res.status(403).json({ error: 'You do not have permission to perform this action.' });
      return null;
    }
  }
  return { uid: decoded.uid, email: decoded.email ?? null, role };
}

/**
 * Allow EITHER the Vercel cron secret OR a signed-in user with an allowed role.
 * Mirrors cron-hopp-sync.js. Returns { trigger: 'cron' | 'manual', uid, role } or null.
 */
export async function requireCronOrUser(req, res, { roles = ['admin', 'owner', 'staff'] } = {}) {
  const token = readBearer(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return null;
  }
  // Vercel sets x-vercel-cron: 1 on every scheduled invocation. External callers
  // cannot spoof this header — Vercel infrastructure strips it from inbound requests.
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
  const user = await requireUser(req, res, { roles });
  if (!user) return null; // requireUser already responded
  return { trigger: 'manual', uid: user.uid, role: user.role };
}
