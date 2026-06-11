/**
 * api/cloudinary-sign.js — Vercel serverless function
 *
 * Generates a Cloudinary signed-upload signature so that the client can
 * perform a direct authenticated upload without ever seeing the API secret.
 *
 * The secret lives only in the server environment and the resulting signature
 * is bound to the exact folder / public_id / timestamp parameters provided,
 * and expires in ≤ 1 hour (Cloudinary rejects older signatures).
 *
 * POST body: { folder: string, public_id: string, context: string }
 * Returns:   { signature: string, api_key: string, timestamp: number, cloud_name: string }
 *
 * Security: the folder MUST begin with `repair-photos/<orgId>/` where orgId is
 * taken from the caller's JWT custom claims (set by sync-claim.js). Any attempt
 * to obtain a signature for another org's folder is rejected with 403.
 *
 * Requires a valid Firebase auth token — unauthenticated callers cannot obtain
 * a signature and therefore cannot upload to the account.
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

  const { folder, public_id, context } = req.body || {};

  if (!folder || !public_id) {
    return res.status(400).json({ error: 'folder and public_id are required' });
  }

  // Org-scope assertion: only allow signing uploads into this org's path prefix.
  const expectedPrefix = `repair-photos/${callerOrgId}/`;
  if (!folder.startsWith(expectedPrefix)) {
    return res.status(403).json({ error: 'Forbidden: folder does not belong to your organisation.' });
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey    = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    console.error('cloudinary-sign: missing server env vars (CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET)');
    return res.status(500).json({ error: 'Cloudinary server credentials not configured' });
  }

  const timestamp = Math.floor(Date.now() / 1000);

  // Build the parameters object — only include context if provided.
  // Cloudinary signature: sort parameter keys alphabetically, join as
  // "key=value&key=value", then append the api_secret (no separator).
  const params = { folder, public_id, timestamp };
  if (context) params.context = context;

  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.map((k) => `${k}=${params[k]}`).join('&');
  const signature = crypto
    .createHash('sha1')
    .update(paramString + apiSecret)
    .digest('hex');

  return res.status(200).json({
    signature,
    api_key: apiKey,
    timestamp,
    cloud_name: cloudName,
  });
}
