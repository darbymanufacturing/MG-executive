/**
 * api/sync-claim.js — mirror a user's {orgId, role} into Firebase custom claims (ADR-0004).
 *
 * POST /api/sync-claim   body: { uid?: string }   (defaults to the caller's own uid)
 *
 * The Firestore rules (Phase 2.4 / B4) authorize by reading `request.auth.token.orgId`
 * and `.role` — i.e. the custom claims, NOT a Firestore doc (a rule can't read another
 * doc cheaply/safely). But the UI source of truth is `users/{uid}` (orgId + role). This
 * endpoint keeps the two in sync: it copies the values FROM the users doc INTO the claims.
 *
 * SECURITY (this is multi-tenant infra — see CLAUDE.md Grounding Rule 7):
 *   - Claims are DERIVED from the `users/{uid}` doc, never from the request body, so a
 *     caller can never grant themselves a role/org they don't already have in Firestore.
 *     (The doc itself is write-protected by the B4 rules — only an org owner/admin may set
 *     another user's role; a user may not flip their own existing role.)
 *   - Authorization: a caller may sync their OWN claims, or — if they are an owner/admin —
 *     the claims of another user IN THE SAME ORG. Any other cross-user attempt is 403.
 *
 * After this succeeds the client MUST call `getIdToken(true)` to pull the refreshed claims
 * into its token (AuthContext.syncClaims does this) or the rules will keep seeing the old
 * (or absent) claims.
 */
import { getDb, getAuth } from './_lib/firebase-admin.js';
import { requireUser } from './_lib/require-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Any signed-in user; finer authorization happens below (self vs. org-admin).
  const caller = await requireUser(req, res);
  if (!caller) return;

  const rawUid = typeof req.body?.uid === 'string' ? req.body.uid.trim() : '';
  const targetUid = rawUid || caller.uid;

  const db = getDb();

  // Source of truth: the target user's Firestore profile.
  const targetSnap = await db.collection('users').doc(targetUid).get();
  if (!targetSnap.exists) {
    return res.status(404).json({ error: 'User profile not found.' });
  }
  const target = targetSnap.data();
  const orgId = target.orgId ?? null;
  const role = target.role ?? null;
  if (!orgId || !role) {
    return res.status(400).json({ error: 'User profile is missing orgId or role — cannot sync claims.' });
  }

  // Cross-check: never mint a privileged claim without verifying against the org doc.
  if (role === 'owner' || role === 'admin') {
    const orgSnap = await db.collection('organizations').doc(orgId).get();
    const org = orgSnap.exists ? orgSnap.data() : null;
    if (!org) {
      return res.status(400).json({ error: 'Organization not found — cannot verify role.' });
    }
    if (role === 'owner' && org.ownerUid !== targetUid) {
      return res.status(403).json({ error: 'role:owner claim refused — user is not the org ownerUid.' });
    }
    if (role === 'admin' && !(org.members || []).includes(targetUid)) {
      return res.status(403).json({ error: 'role:admin claim refused — user is not a member of the org.' });
    }
  }

  // Authorization: self, OR an owner/admin of the SAME org as the target.
  if (targetUid !== caller.uid) {
    const callerSnap = await db.collection('users').doc(caller.uid).get();
    const callerData = callerSnap.exists ? callerSnap.data() : {};
    const callerIsOrgAdmin =
      (callerData.role === 'owner' || callerData.role === 'admin') &&
      !!callerData.orgId &&
      callerData.orgId === orgId;
    if (!callerIsOrgAdmin) {
      return res.status(403).json({ error: 'You can only sync your own claims or those of users in your org.' });
    }
  }

  try {
    // Supabase reads the JWT 'role' claim as the Postgres role to SET ROLE to, so it MUST
    // be 'authenticated' (a real DB role). The app's RBAC role lives in 'user_role'.
    // (Minting role:'admin' made Supabase do SET ROLE admin → "role admin does not exist"
    // → every Supabase request failed. The Firestore rules + AuthContext read 'user_role'.)
    const existing = (await getAuth().getUser(targetUid)).customClaims ?? {};
    await getAuth().setCustomUserClaims(targetUid, { ...existing, orgId, role: 'authenticated', user_role: role });
    return res.status(200).json({ ok: true, uid: targetUid, orgId, role });
  } catch (err) {
    console.error('sync-claim error:', err);
    return res.status(500).json({ error: 'Failed to sync claims' });
  }
}
