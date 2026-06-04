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
 *     (best-effort sequence: atomicity is not guaranteed without a DB transaction; a
 *     redeem_invite RPC is the future hardening — see NOTE below).
 *   - role/orgId come from the INVITE doc (admin-issued), never the request — a contractor
 *     can't pick their org or escalate. role is re-clamped to crew-tier defensively.
 *   - The redeemer's verified token email MUST equal the invited email.
 *   - Claims are set here server-side; the client calls getIdToken(true) after.
 *
 * NOTE: Single-use atomicity is now best-effort (Firestore transaction replaced by a
 * sequential Supabase sequence). A concurrent double-redeem is possible in theory but
 * extremely unlikely (the redeemer uid is fixed and writes are idempotent). A
 * redeem_invite Supabase RPC is the future hardening for this. (ADR-0023 Stage-1)
 *
 * ADR-0023 Stage-1: reads/writes identity via Supabase (users / organizations / invites).
 * Firebase Admin is used for AUTH only (verifyIdToken, setCustomUserClaims, getUser).
 */
import { getAuth, verifyIdToken } from './_lib/firebase-admin.js';
import { sbGetDoc, sbPutDoc, sbPatchDoc } from './_lib/supabase-admin.js';

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

  // source_doc_id for invites IS the token.
  const invite = await sbGetDoc('invites', token);

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
    // (a) Provision the contractor's profile (source of truth for UI + claims).
    await sbPutDoc('users', orgId, uid, {
      role,
      orgId,
      email: invite.email,
      displayName: (typeof req.body?.displayName === 'string' && req.body.displayName.trim())
        || invite.email.split('@')[0],
      assignedScooterIds: Array.isArray(invite.assignedScooterIds) ? invite.assignedScooterIds : [],
      createdAt: new Date().toISOString(),
      invitedBy: invite.createdBy ?? null,
    });

    // (b) Add uid to the org's members array (read-mutate-write; idempotent via Set).
    const orgDoc = await sbGetDoc('organizations', orgId);
    const existingMembers = Array.isArray(orgDoc?.members) ? orgDoc.members : [];
    if (!existingMembers.includes(uid)) {
      const members = [...existingMembers, uid];
      await sbPatchDoc('organizations', orgId, { members });
    }

    // (c) Consume the invite (flip to accepted).
    await sbPatchDoc('invites', token, {
      status: 'accepted',
      acceptedBy: uid,
      acceptedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (String(err.message).includes('already used')) {
      return res.status(409).json({ error: 'This invite has already been used.' });
    }
    console.error('accept-invite provisioning failed:', err);
    return res.status(500).json({ error: 'Could not complete account setup. Please contact your operator.' });
  }

  // Mirror {orgId, role} into custom claims so the rules admit the contractor.
  // IMPORTANT: Supabase reads the JWT 'role' claim as the Postgres role for SET ROLE, so it
  // MUST be 'authenticated'. The app's RBAC role lives in 'user_role' (mirrors _sync-claim.js).
  try {
    const existing = (await getAuth().getUser(uid)).customClaims ?? {};
    await getAuth().setCustomUserClaims(uid, { ...existing, orgId, role: 'authenticated', user_role: role });
  } catch (err) {
    console.error('accept-invite claim set failed:', err);
    // Profile is written; claims can be re-synced via /api/sync-claim. Surface a soft warning.
    return res.status(200).json({ ok: true, orgId, role, claimsPending: true });
  }

  return res.status(200).json({ ok: true, orgId, role });
}
