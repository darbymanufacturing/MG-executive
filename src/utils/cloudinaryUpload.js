/**
 * cloudinaryUpload.js — signed Cloudinary upload (Phase 2.5).
 *
 * Extracted so both PhotoUpload (repair step photos) and SignaturePad (F3 sign-off)
 * share ONE upload path: a server-side signature from /api/cloudinary-sign (the API
 * secret never reaches the client), then a signed direct upload. Accepts any
 * File/Blob, so the signature pad can upload a canvas-generated PNG blob.
 *
 * Returns the Cloudinary secure_url. Throws on failure (caller handles UX).
 */
import { auth } from '../lib/firebase.js';

export async function uploadToCloudinary(file, { folder, publicId, context = '' }) {
  if (!auth.currentUser) throw new Error('Not signed in');
  const idToken = await auth.currentUser.getIdToken();

  // Step 1 — server-side signature (auth-gated; secret stays server-side).
  const signRes = await fetch('/api/cloudinary-sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ folder, public_id: publicId, context }),
  });
  if (!signRes.ok) {
    throw new Error(`Sign request failed ${signRes.status}: ${await signRes.text()}`);
  }
  const { signature, api_key, timestamp, cloud_name } = await signRes.json();

  // Step 2 — signed direct upload.
  const form = new FormData();
  form.append('file', file);
  form.append('api_key', api_key);
  form.append('timestamp', String(timestamp));
  form.append('signature', signature);
  form.append('folder', folder);
  form.append('public_id', publicId);
  if (context) form.append('context', context);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud_name}/image/upload`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`Cloudinary ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.secure_url;
}

/** Canvas → PNG Blob (for the signature pad). Promisified toBlob. */
export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas is empty'))), 'image/png');
  });
}
