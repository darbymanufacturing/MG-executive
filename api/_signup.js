/**
 * api/_signup.js — POST /api/signup
 *
 * Called immediately after a new Firebase auth user is created (client: Signup.jsx).
 * Requires a valid Bearer ID token for the just-created user.
 *
 * Body: { orgName: string, displayName: string }
 *
 * Atomically (best-effort with rollback):
 *   1. Creates organizations row via sbPutDoc
 *   2. Creates the owner users row via sbPutDoc
 *   3. Sets custom claims { orgId, role:'authenticated', user_role:'owner' }
 *
 * On any failure after a write, previously written rows are deleted and 500 is returned.
 * On success: { ok: true, orgId }
 *
 * SECURITY: orgId/ownerUid/members/role all come from the server, never the request body.
 * The Bearer token is verified server-side; no client-supplied uid is accepted.
 */
import { randomBytes } from 'node:crypto';
import { getAuth, verifyIdToken } from './_lib/firebase-admin.js';
import { sbGetDoc, sbPutDoc, sbDelDoc } from './_lib/supabase-admin.js';

const TRIAL_DAYS = 14;

/** Generate a URL-safe base64 org id (22 chars, ~132 bits of entropy). */
function newOrgId() {
  return randomBytes(16).toString('base64url');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify the caller's Firebase ID token.
  const bearer = (req.headers.authorization || '').startsWith('Bearer ')
    ? req.headers.authorization.slice(7).trim() : null;
  if (!bearer) return res.status(401).json({ error: 'Authentication required.' });

  let decoded;
  try { decoded = await verifyIdToken(bearer); }
  catch { return res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' }); }

  const uid = decoded.uid;
  const email = decoded.email ?? '';

  // Idempotency guard: reject if this UID already has a provisioned users row.
  // Without this check a valid Bearer holder can POST /api/signup a second time,
  // generate a fresh orgId, and silently orphan their previous organization.
  let existingUser;
  try { existingUser = await sbGetDoc('users', uid); }
  catch (err) {
    console.error('_signup idempotency check failed:', err);
    return res.status(500).json({ error: 'Could not create your organization. Please try again.' });
  }
  if (existingUser) {
    return res.status(409).json({ error: 'An organization already exists for this account.' });
  }

  // Validate body.
  const orgName = typeof req.body?.orgName === 'string' ? req.body.orgName.trim() : '';
  const displayName = typeof req.body?.displayName === 'string'
    ? req.body.displayName.trim()
    : (email.split('@')[0] || 'User');

  if (!orgName) return res.status(400).json({ error: 'orgName is required.' });

  const orgId = newOrgId();
  const now = new Date().toISOString();
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86400_000).toISOString();

  let orgWritten = false;
  let userWritten = false;

  try {
    // 1. Create the org.
    await sbPutDoc('organizations', orgId, orgId, {
      name: orgName,
      ownerUid: uid,
      members: [uid],
      plan: 'trial',
      trialEndsAt,
      settings: {},
      createdAt: now,
    });
    orgWritten = true;

    // 2. Create the owner profile.
    await sbPutDoc('users', orgId, uid, {
      role: 'owner',
      orgId,
      displayName,
      email,
      createdAt: now,
    });
    userWritten = true;

    // 3. Set custom claims (IMPORTANT: Supabase JWT needs role:'authenticated', app RBAC
    //    role in user_role — ADR-0017/#569).
    const existing = (await getAuth().getUser(uid)).customClaims ?? {};
    await getAuth().setCustomUserClaims(uid, { ...existing, orgId, role: 'authenticated', user_role: 'owner' });

    return res.status(200).json({ ok: true, orgId });
  } catch (err) {
    console.error('_signup provisioning failed:', err);

    // Best-effort rollback in reverse order.
    if (userWritten) {
      try { await sbDelDoc('users', uid); } catch (_) { /* rollback best-effort */ }
    }
    if (orgWritten) {
      try { await sbDelDoc('organizations', orgId); } catch (_) { /* rollback best-effort */ }
    }

    return res.status(500).json({ error: 'Could not create your organization. Please try again.' });
  }
}
