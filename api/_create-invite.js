/**
 * api/create-invite.js — Phase 2.5 F6. An org owner/admin issues a contractor invite.
 *
 * POST /api/create-invite   body: { email, role?, assignedScooterIds? }
 *
 * Writes invites/{token} { orgId, role, email, status:'pending', expiresAt, createdBy,
 * orgName, assignedScooterIds }, and (if Resend is configured) emails the join link.
 * The token is a random, single-use credential — the contractor sets their own password
 * via /accept-invite?token=… (api/accept-invite.js).
 *
 * SECURITY (multi-tenant infra — Grounding Rule 7):
 *   - Caller must be a signed-in owner/admin (require-auth role check).
 *   - The invite's orgId is taken from the CALLER's verified users-doc, never the body —
 *     an admin can only invite into their OWN org.
 *   - role is clamped to crew-tier (contractor/crew/technician); you cannot invite an
 *     owner/admin via this funnel (privilege-escalation guard).
 */
import { randomBytes } from 'node:crypto';
import { getDb, FieldValue } from './_lib/firebase-admin.js';
import { requireUser } from './_lib/require-auth.js';

const INVITE_TTL_DAYS = 7;
const INVITABLE_ROLES = ['contractor', 'crew', 'technician'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const caller = await requireUser(req, res, { roles: ['owner', 'admin'] });
  if (!caller) return;

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }
  const reqRole = typeof req.body?.role === 'string' ? req.body.role : 'contractor';
  const role = INVITABLE_ROLES.includes(reqRole) ? reqRole : 'contractor';
  const assignedScooterIds = Array.isArray(req.body?.assignedScooterIds)
    ? req.body.assignedScooterIds.map(String).slice(0, 500)
    : [];

  const db = getDb();

  // Org comes from the caller's verified profile — never the request body.
  const callerSnap = await db.collection('users').doc(caller.uid).get();
  const callerData = callerSnap.exists ? callerSnap.data() : {};
  const orgId = callerData.orgId;
  if (!orgId) return res.status(400).json({ error: 'Your account is not linked to an organization.' });

  const orgSnap = await db.collection('organizations').doc(orgId).get();
  const orgName = orgSnap.exists ? (orgSnap.data().name ?? 'your operator') : 'your operator';

  // Single-use random token (URL-safe).
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400000).toISOString();

  try {
    await db.collection('invites').doc(token).set({
      orgId,
      orgName,
      email,
      role,
      assignedScooterIds,
      status: 'pending',
      expiresAt,
      createdBy: caller.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('create-invite write failed:', err);
    return res.status(500).json({ error: 'Could not create the invite.' });
  }

  // The join link the contractor opens. APP_BASE_URL falls back to the request origin.
  const base = process.env.APP_BASE_URL || (req.headers.origin ?? '');
  const link = `${base}/accept-invite?token=${token}`;

  // Best-effort email (Resend, already used for Hopp alerts). Never fails the request —
  // the admin always gets the copyable link back regardless.
  let emailed = false;
  if (process.env.RESEND_API_KEY) {
    try {
      const { Resend } = await import('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'Omni <noreply@mgexecutive.app>',
        to: [email],
        subject: `You've been invited to work with ${orgName} on Omni`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:520px">
            <h2 style="color:#A0521D;margin:0 0 8px">You're invited to Omni CREW</h2>
            <p style="color:#334155">${orgName} has invited you to handle scooter repairs through the Omni contractor portal.</p>
            <p style="margin:20px 0"><a href="${link}" style="background:#A0521D;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600">Set up your account</a></p>
            <p style="color:#94a3b8;font-size:12px">This invite expires in ${INVITE_TTL_DAYS} days. You'll only see the jobs assigned to you — never the operator's business data.</p>
          </div>`,
      });
      emailed = true;
    } catch (err) {
      console.error('create-invite email failed (link still returned):', err);
    }
  }

  return res.status(200).json({ ok: true, token, link, email, role, expiresAt, emailed });
}
