/**
 * api/accept-invite.js — Phase 2.5 F6. A contractor redeems an invite token.
 *
 * Two modes (both POST /api/accept-invite):
 *   { token, peek: true }          → validate + return { orgName, email } for the form
 *                                    (no auth required; reveals only org name + invited email)
 *   { token } + Bearer <ID token>  → REDEEM: the just-created auth user (email must match
 *                                    the invite) gets a users/{uid} doc with the invite's
 *                                    orgId + role, is added to the org members, the invite is
 *                                    consumed, and custom claims are set.
 *
 * SECURITY (multi-tenant infra — Grounding Rule 7):
 *   - The token IS the credential; we validate status:'pending' + not expired, single-use
 *     (atomically flipped to 'accepted' so a token can't be redeemed twice / raced).
 *   - role/orgId come from the INVITE doc (admin-issued), never the request — a contractor
 *     can't pick their org or escalate. role is re-clamped to crew-tier defensively.
 *   - The redeemer's verified token email MUST equal the invited email.
 *   - Claims are set here server-side; the client calls getIdToken(true) after.
 */
import { getDb, getAuth, FieldValue, verifyIdToken } from './_lib/firebase-admin.js';

const INVITABLE_ROLES = ['contractor', 'crew', 'technician'];

function inviteIsValid(inv) {
  if (!inv || inv.status !== 'pending') return false;
  if (inv.expiresAt && new Date(inv.expiresAt).getTime() < Date.now()) return false;
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!token) return res.status(400).json({ error: 'Missing invite token.' });

  const db = getDb();
  const inviteRef = db.collection('invites').doc(token);
  const snap = await inviteRef.get();
  const invite = snap.exists ? snap.data() : null;

  // ── Peek mode: surface org + email so the form can pre-fill (no auth). ──
  if (req.body?.peek) {
    if (!inviteIsValid(invite)) {
      return res.status(404).json({ valid: false, error: 'This invite is invalid or has expired.' });
    }
    return res.status(200).json({ valid: true, orgName: invite.orgName ?? '', email: invite.email });
  }

  // ── Redeem mode: requires the freshly-created auth user's ID token. ──
  const bearer = (req.headers.authorization || '').startsWith('Bearer ')
    ? req.headers.authorization.slice(7).trim() : null;
  if (!bearer) return res.status(401).json({ error: 'Sign-in required to accept the invite.' });

  let decoded;
  try { decoded = await verifyIdToken(bearer); }
  catch { return res.status(401).json({ error: 'Invalid or expired session.' }); }

  if (!inviteIsValid(invite)) {
    return res.status(404).json({ error: 'This invite is invalid or has already been used.' });
  }

  // The redeemer must be the invited email (case-insensitive).
  const tokenEmail = (decoded.email ?? '').toLowerCase();
  if (!tokenEmail || tokenEmail !== String(invite.email).toLowerCase()) {
    return res.status(403).json({ error: 'This invite was issued for a different email address.' });
  }

  const orgId = invite.orgId;
  const role = INVITABLE_ROLES.includes(invite.role) ? invite.role : 'contractor';
  const uid = decoded.uid;

  try {
    // Atomic single-use: flip pending→accepted only if still pending (transaction guards races).
    await db.runTransaction(async (txn) => {
      const fresh = await txn.get(inviteRef);
      if (!fresh.exists || fresh.data().status !== 'pending') {
        throw new Error('Invite already used');
      }
      // Provision the contractor's profile (the UI + claims source of truth).
      txn.set(db.collection('users').doc(uid), {
        role,
        orgId,
        email: invite.email,
        displayName: (typeof req.body?.displayName === 'string' && req.body.displayName.trim())
          || invite.email.split('@')[0],
        assignedScooterIds: Array.isArray(invite.assignedScooterIds) ? invite.assignedScooterIds : [],
        createdAt: FieldValue.serverTimestamp(),
        invitedBy: invite.createdBy ?? null,
      });
      // Add to the org's member list.
      txn.update(db.collection('organizations').doc(orgId), {
        members: FieldValue.arrayUnion(uid),
      });
      // Consume the invite.
      txn.update(inviteRef, {
        status: 'accepted',
        acceptedBy: uid,
        acceptedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (err) {
    if (String(err.message).includes('already used')) {
      return res.status(409).json({ error: 'This invite has already been used.' });
    }
    console.error('accept-invite provisioning failed:', err);
    return res.status(500).json({ error: 'Could not complete account setup. Please contact your operator.' });
  }

  // Mirror {orgId, role} into custom claims so the rules admit the contractor.
  try {
    await getAuth().setCustomUserClaims(uid, { orgId, role });
  } catch (err) {
    console.error('accept-invite claim set failed:', err);
    // Profile is written; claims can be re-synced via /api/sync-claim. Surface a soft warning.
    return res.status(200).json({ ok: true, orgId, role, claimsPending: true });
  }

  return res.status(200).json({ ok: true, orgId, role });
}
