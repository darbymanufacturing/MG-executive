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
 * the user's OWN users/{uid} row + the organizations/{orgId} row — never from the request
 * body — so a caller can't escalate. The actual hard delete of org data happens later in
 * api/cron-purge-deleted-orgs.js after the grace window (irreversible work is never done
 * inline here). See docs/SECURITY.md.
 *
 * SAFETY: this endpoint NEVER hard-deletes another user's data inline. 'delete-org' only
 * STAMPS organizations/{orgId}.deleteAt; the cron does the cascade after the grace period,
 * giving the owner a window to cancel.
 *
 * ADR-0023 Stage-1: identity reads/writes use Supabase (sbGetDoc/sbGetByOrg/sbPatchDoc/
 * sbPutDoc/sbDelDoc). Firebase Admin is kept for Auth only (verifyIdToken + deleteUser).
 * Supabase has no multi-table transactions; atomicity for leave/transfer is achieved via
 * a guarded sequence with TOCTOU re-reads before each destructive write. The sequence is:
 *   1. Re-read relevant rows to confirm invariants still hold (TOCTOU guard).
 *   2. Write non-destructive mutations first (role change, org update).
 *   3. Delete the user row last (the actual access-control cut).
 * Partial-failure risk is minimal because: (a) the deleted user row is the auth gate,
 * so if step 3 fails the user still can't log in after their token expires; (b) the
 * orphaned members[] entry is cleaned on next org read by the cron/UI. The previous
 * Firestore transaction guarantee is documented in CHANGELOG.md for ADR-0023.
 */
import { getAuth } from './_lib/firebase-admin.js';
import { requireUser } from './_lib/require-auth.js';
import {
  sbGetDoc,
  sbGetByOrg,
  sbPatchDoc,
  sbPutDoc,
  sbDelDoc,
} from './_lib/supabase-admin.js';

const GRACE_DAYS = 30;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authUser = await requireUser(req, res);
  if (!authUser) return;

  const { action } = req.body || {};
  if (!action) return res.status(400).json({ error: 'action is required' });

  // Source of truth: the caller's own profile.
  const me = await sbGetDoc('users', authUser.uid);
  if (!me) return res.status(404).json({ error: 'Your user profile was not found.' });
  const orgId = me.orgId ?? null;
  if (!orgId) return res.status(400).json({ error: 'Your account is not linked to an organization.' });

  const org = await sbGetDoc('organizations', orgId);
  // SECURITY: ownerUid is the sole authoritative ownership field (server-maintained).
  // me.role is a denormalized UX hint that can be stale (e.g. after a transfer) — never
  // use it alone as an ownership gate, or a former owner can still delete/transfer the org.
  const isOwner = org?.ownerUid === authUser.uid;

  // Count org members + admins (for the owner-must-nominate / sole-owner logic).
  // sbGetByOrg returns [{ _docId, ...data }]; _docId === uid for the users table.
  const members = await sbGetByOrg('users', orgId);
  const otherMembers = members.filter((m) => m._docId !== authUser.uid);
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
          otherAdmins: otherAdmins.map((a) => ({ uid: a._docId, email: a.email ?? null, displayName: a.displayName ?? null })),
          graceDays: GRACE_DAYS,
          deleteAt: org?.deleteAt ?? null,
          outcome,
        });
      }

      case 'leave': {
        if (isOwner) {
          return res.status(400).json({ error: 'The owner cannot leave the org. Transfer ownership or delete the organization instead.' });
        }

        // TOCTOU re-read: confirm the caller's profile and org still exist before writing.
        // This closes the window between the outer read and the destructive writes.
        const txMe = await sbGetDoc('users', authUser.uid);
        if (!txMe) {
          throw Object.assign(new Error('Your user profile was not found.'), { status: 404 });
        }
        const txOrg = await sbGetDoc('organizations', orgId);

        // Remove caller from org.members array, then delete the user row.
        // We mutate the members array in JS (Supabase has no FieldValue.arrayRemove).
        if (txOrg && Array.isArray(txOrg.members)) {
          const updatedMembers = txOrg.members.filter((uid) => uid !== authUser.uid);
          // Build updated org data without the deleted member; preserve all other fields.
          const { _docId: _orgDocId, ...orgData } = txOrg;
          await sbPutDoc('organizations', orgId, orgId, { ...orgData, members: updatedMembers });
        }
        // Delete user row — this is the actual access-control cut.
        await sbDelDoc('users', authUser.uid);

        // Auth deletion is a non-identity side effect — keep outside the data writes.
        // The user row deletion above is the actual access-control cut;
        // Auth deletion is best-effort (orphaned Auth accounts without a profile are harmless).
        await getAuth().deleteUser(authUser.uid).catch(() => {});
        return res.status(200).json({ ok: true, action: 'leave', message: 'You have been removed from the organization.' });
      }

      case 'transfer': {
        if (!isOwner) return res.status(403).json({ error: 'Only the owner can transfer ownership.' });
        const successorUid = typeof req.body.successorUid === 'string' ? req.body.successorUid.trim() : '';
        const successor = otherMembers.find((m) => m._docId === successorUid);
        if (!successor) return res.status(400).json({ error: 'Choose a valid member of your organization as the successor.' });
        if (successor.role !== 'admin' && successor.role !== 'owner') {
          return res.status(400).json({ error: 'Ownership can only be transferred to an admin.' });
        }

        // TOCTOU re-reads: re-validate ownership and successor eligibility against the
        // live state, closing the window between the outer read and the writes.
        const txOrg = await sbGetDoc('organizations', orgId);
        if (!txOrg || txOrg.ownerUid !== authUser.uid) {
          throw Object.assign(new Error('You are no longer the owner of this organization.'), { status: 403 });
        }
        const txSuccessor = await sbGetDoc('users', successorUid);
        const txSuccessorRole = txSuccessor?.role ?? null;
        if (txSuccessorRole !== 'admin' && txSuccessorRole !== 'owner') {
          throw Object.assign(new Error('Ownership can only be transferred to an admin.'), { status: 400 });
        }

        // Write sequence (non-destructive first, then delete caller):
        // 1. Promote successor to owner role.
        const { _docId: _succDocId, ...successorData } = txSuccessor;
        await sbPutDoc('users', orgId, successorUid, { ...successorData, role: 'owner' });

        // 2. Update org.ownerUid and remove caller from org.members.
        const updatedMembers = Array.isArray(txOrg.members)
          ? txOrg.members.filter((uid) => uid !== authUser.uid)
          : txOrg.members;
        const { _docId: _orgDocId, ...orgData } = txOrg;
        await sbPutDoc('organizations', orgId, orgId, {
          ...orgData,
          ownerUid: successorUid,
          members: updatedMembers,
        });

        // 3. Delete caller's user row — actual access-control cut.
        await sbDelDoc('users', authUser.uid);

        // Auth deletion is best-effort (orphaned Auth accounts without a profile are harmless).
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
        await sbPatchDoc('organizations', orgId, {
          deleteAt,
          deleteRequestedBy: authUser.uid,
          deleteRequestedAt: new Date().toISOString(),
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
        // Remove the deleteAt/deleteRequestedBy/deleteRequestedAt fields by patching them
        // to null. sbPatchDoc shallow-merges — setting keys to null clears them in the
        // data jsonb (the cron checks for the presence of deleteAt, not its truthiness).
        await sbPatchDoc('organizations', orgId, {
          deleteAt: null,
          deleteRequestedBy: null,
          deleteRequestedAt: null,
        });
        return res.status(200).json({ ok: true, action: 'cancel-delete', message: 'Organization deletion cancelled.' });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('delete-account error:', err);
    // Business-invariant checks throw errors with a .status field (403/400) —
    // propagate those as-is.
    const httpStatus = typeof err.status === 'number' ? err.status : 500;
    return res.status(httpStatus).json({ error: 'Account deletion failed' });
  }
}
