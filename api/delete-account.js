/**
 * api/delete-account.js — self-service account / organization deletion (ROADMAP 2.6).
 *
 * A store + GDPR requirement: a user must be able to delete their own account, and an
 * org owner must be able to delete the whole organization (with a grace period).
 *
 * POST /api/delete-account
 *   body (JSON), one of:
 *     { action: 'preview' }                      → returns what deletion WOULD do (no writes)
 *     { action: 'leave' }                         → a NON-owner removes themselves from the org
 *     { action: 'transfer', successorUid }        → owner hands ownership to an org admin, then leaves
 *     { action: 'delete-org', confirm: '<name>' } → owner schedules org deletion (30-day grace)
 *
 * Auth: a signed-in Firebase user (requireUser). All decisions are made server-side from
 * the user's OWN users/{uid} doc + the organizations/{orgId} doc — never from the request
 * body — so a caller can't escalate. The actual hard delete of org data happens later in
 * api/cron-purge-deleted-orgs.js after the grace window (irreversible work is never done
 * inline here). See docs/SECURITY.md.
 *
 * SAFETY: this endpoint NEVER hard-deletes another user's data inline. 'delete-org' only
 * STAMPS organizations/{orgId}.deleteAt; the cron does the cascade after the grace period,
 * giving the owner a window to cancel.
 */
import { getDb, getAuth, FieldValue } from './_lib/firebase-admin.js';
import { requireUser } from './_lib/require-auth.js';

const GRACE_DAYS = 30;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authUser = await requireUser(req, res);
  if (!authUser) return;

  const db = getDb();
  const { action } = req.body || {};
  if (!action) return res.status(400).json({ error: 'action is required' });

  // Source of truth: the caller's own profile.
  const meSnap = await db.collection('users').doc(authUser.uid).get();
  if (!meSnap.exists) return res.status(404).json({ error: 'Your user profile was not found.' });
  const me = meSnap.data();
  const orgId = me.orgId ?? null;
  const myRole = me.role ?? null;
  if (!orgId) return res.status(400).json({ error: 'Your account is not linked to an organization.' });

  const orgRef = db.collection('organizations').doc(orgId);
  const orgSnap = await orgRef.get();
  const org = orgSnap.exists ? orgSnap.data() : null;
  // SECURITY: ownerUid is the sole authoritative ownership field (server-maintained).
  // myRole is a denormalized UX hint that can be stale (e.g. after a transfer) — never
  // use it alone as an ownership gate, or a former owner can still delete/transfer the org.
  const isOwner = org?.ownerUid === authUser.uid;

  // Count org members + admins (for the owner-must-nominate / sole-owner logic).
  const membersSnap = await db.collection('users').where('orgId', '==', orgId).get();
  const members = membersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  const otherMembers = members.filter((m) => m.uid !== authUser.uid);
  const otherAdmins = otherMembers.filter((m) => m.role === 'owner' || m.role === 'admin');

  try {
    switch (action) {
      case 'preview': {
        let outcome;
        if (!isOwner) {
          outcome = 'leave'; // non-owner just removes self
        } else if (otherMembers.length === 0) {
          outcome = 'delete-org'; // sole member → schedule full org deletion
        } else if (otherAdmins.length === 0) {
          outcome = 'delete-org-with-members'; // owner + non-admin members → still org deletion (warn)
        } else {
          outcome = 'transfer-or-delete'; // owner with admins → may nominate a successor OR delete the org
        }
        return res.status(200).json({
          ok: true,
          isOwner,
          orgId,
          orgName: org?.name ?? null,
          memberCount: members.length,
          otherAdmins: otherAdmins.map((a) => ({ uid: a.uid, email: a.email ?? null, displayName: a.displayName ?? null })),
          graceDays: GRACE_DAYS,
          deleteAt: org?.deleteAt ?? null,
          outcome,
        });
      }

      case 'leave': {
        if (isOwner) {
          return res.status(400).json({ error: 'The owner cannot leave the org. Transfer ownership or delete the organization instead.' });
        }
        // Remove the member: delete their profile doc + their Auth account.
        await db.collection('users').doc(authUser.uid).delete();
        await getAuth().deleteUser(authUser.uid).catch(() => {}); // best-effort; profile gone is the access cut
        // Drop from the org members array if present.
        if (org && Array.isArray(org.members)) {
          await orgRef.update({ members: FieldValue.arrayRemove(authUser.uid) });
        }
        return res.status(200).json({ ok: true, action: 'leave', message: 'You have been removed from the organization.' });
      }

      case 'transfer': {
        if (!isOwner) return res.status(403).json({ error: 'Only the owner can transfer ownership.' });
        const successorUid = typeof req.body.successorUid === 'string' ? req.body.successorUid.trim() : '';
        const successor = otherMembers.find((m) => m.uid === successorUid);
        if (!successor) return res.status(400).json({ error: 'Choose a valid member of your organization as the successor.' });
        if (successor.role !== 'admin' && successor.role !== 'owner') {
          return res.status(400).json({ error: 'Ownership can only be transferred to an admin.' });
        }
        // TOCTOU fix: wrap all Firestore writes in a single transaction so they are atomic.
        // If any write fails (contention, network) the entire set rolls back — we never end
        // up with two effective owners (successor's role='owner' but org.ownerUid unchanged).
        // The re-reads inside the transaction re-validate ownership and successor eligibility
        // against the live state, closing the window between the outer read and the writes.
        const successorRef = db.collection('users').doc(successorUid);
        const meRef = db.collection('users').doc(authUser.uid);
        await db.runTransaction(async (tx) => {
          const [txOrgSnap, txSuccessorSnap] = await Promise.all([
            tx.get(orgRef),
            tx.get(successorRef),
          ]);
          // Re-validate ownership inside the transaction (TOCTOU guard).
          if (!txOrgSnap.exists || txOrgSnap.data().ownerUid !== authUser.uid) {
            throw Object.assign(new Error('You are no longer the owner of this organization.'), { status: 403 });
          }
          // Re-validate successor eligibility inside the transaction.
          const txSuccessorRole = txSuccessorSnap.exists ? txSuccessorSnap.data().role : null;
          if (txSuccessorRole !== 'admin' && txSuccessorRole !== 'owner') {
            throw Object.assign(new Error('Ownership can only be transferred to an admin.'), { status: 400 });
          }
          tx.update(successorRef, { role: 'owner' });
          tx.update(orgRef, { ownerUid: successorUid, members: FieldValue.arrayRemove(authUser.uid) });
          tx.delete(meRef);
        });
        // Auth deletion is a non-Firestore side effect — keep outside the transaction.
        // The profile doc deletion (inside the transaction) is the actual access-control cut;
        // Auth deletion is best-effort (orphaned Auth accounts are harmless without a profile).
        await getAuth().deleteUser(authUser.uid).catch(() => {});
        // NOTE: the successor must call /api/sync-claim (or re-login) to refresh their owner claim.
        return res.status(200).json({
          ok: true,
          action: 'transfer',
          newOwnerUid: successorUid,
          message: 'Ownership transferred and your account was removed.',
          successorMustResync: true,
        });
      }

      case 'delete-org': {
        if (!isOwner) return res.status(403).json({ error: 'Only the owner can delete the organization.' });
        // Typed-confirmation: body.confirm must equal the org name (defense against accidents).
        const confirm = typeof req.body.confirm === 'string' ? req.body.confirm.trim() : '';
        if (!org?.name || confirm !== org.name) {
          return res.status(400).json({ error: `Type the organization name ("${org?.name ?? ''}") to confirm.` });
        }
        const deleteAt = new Date(Date.now() + GRACE_DAYS * 86400000).toISOString();
        // STAMP ONLY — the cron does the cascade after the grace window. Reversible until then.
        await orgRef.update({
          deleteAt,
          deleteRequestedBy: authUser.uid,
          deleteRequestedAt: FieldValue.serverTimestamp(),
        });
        return res.status(200).json({
          ok: true,
          action: 'delete-org',
          deleteAt,
          graceDays: GRACE_DAYS,
          message: `Organization scheduled for deletion on ${deleteAt.slice(0, 10)}. You can cancel any time before then.`,
        });
      }

      case 'cancel-delete': {
        if (!isOwner) return res.status(403).json({ error: 'Only the owner can cancel deletion.' });
        // Refuse if the cron purge is already in flight (purgeStartedAt is set).
        if (org?.purgeStartedAt) {
          return res.status(409).json({ error: 'Purge already in flight — cannot cancel. Contact support if data has not yet been deleted.' });
        }
        await orgRef.update({
          deleteAt: FieldValue.delete(),
          deleteRequestedBy: FieldValue.delete(),
          deleteRequestedAt: FieldValue.delete(),
        });
        return res.status(200).json({ ok: true, action: 'cancel-delete', message: 'Organization deletion cancelled.' });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('delete-account error:', err);
    // Transaction aborts throw errors with a .status field (403/400) when the business
    // invariant check fails inside the transaction — propagate those as-is.
    const httpStatus = typeof err.status === 'number' ? err.status : 500;
    return res.status(httpStatus).json({ error: 'Account deletion failed' });
  }
}
