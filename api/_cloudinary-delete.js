/**
 * api/cloudinary-delete.js — Vercel serverless function
 *
 * DELETE a Cloudinary asset by public_id using a server-side signed request.
 * Requires a valid Firebase auth token so only authenticated users can trigger
 * deletions. Uses CLOUDINARY_API_SECRET (never exposed to the client bundle).
 *
 * Security: the publicId MUST begin with `repair-photos/<orgId>/` where orgId
 * is taken from the caller's JWT custom claims (set by sync-claim.js). Any
 * attempt to delete an asset from another org's path is rejected with 403.
 *
 * POST body: { publicId: string }
 * Returns:   { result: string }   ("ok" on success, Cloudinary's response otherwise)
 */
import crypto from 'node:crypto';
import { requireUser } from './_lib/require-auth.js';
import { verifyIdToken } from './_lib/firebase-admin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authUser = await requireUser(req, res);
  if (!authUser) return;

  // Read the full decoded token to get the orgId custom claim (set by sync-claim.js).
  // requireUser already validated the token so verifyIdToken will not throw here.
  const rawToken = (req.headers.authorization || '').replace(/^Bearer /, '').trim();
  const decoded = await verifyIdToken(rawToken);
  const callerOrgId = decoded.orgId ?? null;

  if (!callerOrgId) {
    return res.status(403).json({ error: 'No org claim found — re-authenticate and try again.' });
  }

  const { publicId } = req.body || {};
  if (!publicId || typeof publicId !== 'string' || publicId.trim().length === 0) {
    return res.status(400).json({ error: 'publicId is required' });
  }

  // Org-scope assertion: only allow deletion of assets under this org's path prefix.
  const expectedPrefix = `repair-photos/${callerOrgId}/`;
  if (!publicId.startsWith(expectedPrefix)) {
    return res.status(403).json({ error: 'Forbidden: publicId does not belong to your organisation.' });
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey    = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    console.error('cloudinary-delete: missing server env vars (CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET)');
    return res.status(500).json({ error: 'Cloudinary server credentials not configured' });
  }

  const timestamp = Math.floor(Date.now() / 1000);

  // Cloudinary signature for destroy: SHA-1(public_id=<id>&timestamp=<ts><api_secret>)
  // Parameters must be sorted alphabetically before hashing.
  const sigParams = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash('sha1').update(sigParams).digest('hex');

  const formData = new URLSearchParams();
  formData.append('public_id', publicId);
  formData.append('timestamp', String(timestamp));
  formData.append('api_key', apiKey);
  formData.append('signature', signature);

  try {
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`,
      { method: 'POST', body: formData }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('cloudinary-delete: Cloudinary error', data);
      return res.status(response.status).json({ error: 'Cloudinary delete failed' });
    }

    return res.status(200).json({ result: data.result });
  } catch (err) {
    console.error('cloudinary-delete error:', err);
    return res.status(500).json({ error: 'Delete request failed' });
  }
}
