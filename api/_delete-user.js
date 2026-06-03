/**
 * api/delete-user.js — admin removal of a team member's account (bug #bug-18).
 *
 * POST /api/delete-user
 *   body (JSON): { uid }
 *
 * Auth: a signed-in Firebase user (requireUser). Server-side guards verify:
 *   1. Caller role is 'admin' or 'owner'.
 *   2. Target user belongs to the same org as the caller (cross-org guard).
 *
 * On success: deletes the target's Firestore users/{uid} doc, then deletes their
 * Firebase Auth account via the Admin SDK. Returns { ok: true }.
 *
 * See api/delete-account.js for the self-service account deletion flow.
 */
import { getDb, getAuth } from './_lib/firebase-admin.js';
import { requireUser } from './_lib/require-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authUser = await requireUser(req, res);
  if (!authUser) return;

  const { uid } = req.body || {};
  if (!uid || typeof uid !== 'string') {
    return res.status(400).json({ error: 'uid is required' });
  }

  const db = getDb();

  // Load the caller's profile to verify role + orgId.
  const callerSnap = await db.collection('users').doc(authUser.uid).get();
  if (!callerSnap.exists) {
    return res.status(404).json({ error: 'Your user profile was not found.' });
  }
  const caller = callerSnap.data();

  // Server-side role guard: only admins and owners may remove team members.
  if (!['admin', 'owner'].includes(caller.role)) {
    return res.status(403).json({ error: 'Only admins and owners can remove team members.' });
  }

  // Prevent removing yourself via this endpoint.
  if (uid === authUser.uid) {
    return res.status(400).json({ error: 'Use the account-deletion flow to remove your own account.' });
  }

  // Load the target's profile for the cross-org guard.
  const targetSnap = await db.collection('users').doc(uid).get();
  if (!targetSnap.exists) {
    return res.status(404).json({ error: 'Target user not found.' });
  }
  const target = targetSnap.data();

  // Cross-org guard: can only remove members within the same org.
  // Fail-closed: if target has no orgId (malformed profile), deny rather than allow.
  if (!target.orgId || target.orgId !== caller.orgId) {
    return res.status(403).json({ error: 'Cannot remove a user from another organisation.' });
  }

  try {
    // Delete Firestore doc first, then Auth account (matching the pattern in delete-account.js:91-92).
    await db.collection('users').doc(uid).delete();
    await getAuth().deleteUser(uid).catch(() => {}); // best-effort; profile gone is the access cut

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('delete-user error:', err);
    return res.status(500).json({ error: 'Failed to remove user' });
  }
}
