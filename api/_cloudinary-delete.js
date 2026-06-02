/**
 * api/cloudinary-delete.js — Vercel serverless function
 *
 * DELETE a Cloudinary asset by public_id using a server-side signed request.
 * Requires a valid Firebase auth token so only authenticated users can trigger
 * deletions. Uses CLOUDINARY_API_SECRET (never exposed to the client bundle).
 *
 * POST body: { publicId: string }
 * Returns:   { result: string }   ("ok" on success, Cloudinary's response otherwise)
 */
import crypto from 'node:crypto';
import { requireUser } from './_lib/require-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authUser = await requireUser(req, res);
  if (!authUser) return;

  const { publicId } = req.body || {};
  if (!publicId || typeof publicId !== 'string' || publicId.trim().length === 0) {
    return res.status(400).json({ error: 'publicId is required' });
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
      return res.status(response.status).json({ error: data.error?.message || 'Cloudinary delete failed' });
    }

    return res.status(200).json({ result: data.result });
  } catch (err) {
    console.error('cloudinary-delete error:', err);
    return res.status(500).json({ error: err.message || 'Delete request failed' });
  }
}
