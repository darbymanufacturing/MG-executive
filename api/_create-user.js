/**
 * api/_create-user.js — POST /api/create-user
 *
 * Admin-only endpoint: creates a new auth user + Supabase profile within the
 * caller's org. Replaces the old client-side REST flow that wrote directly to
 * Firestore (AuthContext already POSTs here).
 *
 * Auth: requireUser — caller must be authenticated. Server-side re-verification
 * reads the caller's profile from Supabase for orgId and role.
 *
 * Body: { email, password, displayName, role }
 *
 * Allowed roles: crew, staff, admin, technician, contractor
 * Creating an admin requires the caller to be 'owner' (#452).
 *
 * Steps:
 *   1. Read caller profile from Supabase for orgId + role.
 *   2. Validate / clamp the requested role.
 *   3. Create the Firebase auth user.
 *   4. Write the Supabase users profile.
 *   5. Set custom claims.
 *   If steps 4–5 fail, roll back by deleting the auth user.
 *
 * Returns { ok: true, uid }
 *
 * SECURITY: orgId always comes from the caller's server-side profile — never from
 * the request body. Cross-org writes are structurally impossible.
 */
import { getAuth } from './_lib/firebase-admin.js';
import { requireUser } from './_lib/require-auth.js';
import { sbGetDoc, sbPutDoc } from './_lib/supabase-admin.js';

const ALLOWED_ROLES = ['crew', 'staff', 'admin', 'technician', 'contractor'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authUser = await requireUser(req, res);
  if (!authUser) return;

  // Load the caller's profile from Supabase to get orgId + role.
  const callerProfile = await sbGetDoc('users', authUser.uid);
  if (!callerProfile) {
    return res.status(404).json({ error: 'Your user profile was not found.' });
  }

  const callerRole = callerProfile.role ?? null;
  const callerOrgId = callerProfile.orgId ?? null;

  // Caller must be owner or admin.
  if (!['owner', 'admin'].includes(callerRole)) {
    return res.status(403).json({ error: 'Only admins and owners can create team members.' });
  }

  if (!callerOrgId) {
    return res.status(400).json({ error: 'Your profile is missing an orgId. Please contact support.' });
  }

  const { email, password, displayName, role: requestedRole } = req.body || {};

  if (!email || typeof email !== 'string') return res.status(400).json({ error: 'email is required.' });
  if (!password || typeof password !== 'string') return res.status(400).json({ error: 'password is required.' });

  // Clamp role to the allowed set; fall back to 'crew'.
  const role = ALLOWED_ROLES.includes(requestedRole) ? requestedRole : 'crew';

  // Creating an admin requires the caller to be the owner (#452).
  if (role === 'admin' && callerRole !== 'owner') {
    return res.status(403).json({ error: 'Only the org owner can create admin accounts.' });
  }

  const resolvedDisplayName =
    (typeof displayName === 'string' && displayName.trim())
    || (email.split('@')[0] || 'User');

  const now = new Date().toISOString();

  // Create the Firebase Auth user.
  let newUid;
  try {
    const newUser = await getAuth().createUser({ email, password, displayName: resolvedDisplayName });
    newUid = newUser.uid;
  } catch (err) {
    // Bubble Firebase auth errors (e.g. email-already-exists) as 400.
    const msg = err?.message || 'Failed to create user account.';
    return res.status(400).json({ error: msg });
  }

  try {
    // Write the Supabase profile.
    await sbPutDoc('users', callerOrgId, newUid, {
      role,
      orgId: callerOrgId,
      displayName: resolvedDisplayName,
      email,
      createdAt: now,
    });

    // Set custom claims (IMPORTANT: Supabase JWT needs role:'authenticated', app RBAC
    // role in user_role — ADR-0017/#569).
    const existing = (await getAuth().getUser(newUid)).customClaims ?? {};
    await getAuth().setCustomUserClaims(newUid, { ...existing, orgId: callerOrgId, role: 'authenticated', user_role: role });

    return res.status(200).json({ ok: true, uid: newUid });
  } catch (err) {
    console.error('_create-user provisioning failed (rolling back auth user):', err);

    // Roll back the auth user so the email can be reused.
    try { await getAuth().deleteUser(newUid); } catch (_) { /* rollback best-effort */ }

    return res.status(500).json({ error: 'Could not create the user account. Please try again.' });
  }
}
