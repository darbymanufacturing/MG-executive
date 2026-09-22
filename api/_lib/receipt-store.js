/**
 * api/_lib/receipt-store.js — keep the original receipt/invoice file for every
 * automatically captured expense (docs/AUTOMATION_PLAN.md §4.4: "receipts from
 * photos, kept for VAT audits").
 *
 * The Capture box's OCR used to discard the photo after reading it, so an
 * expense in the books had no document behind it. Automated intake (WhatsApp,
 * Gmail) uploads the file to Cloudinary here and stores the URL on the intake
 * item; approving it copies the URL onto the cost as `receiptUrl`, and the
 * monthly accountant pack links to it.
 *
 * Signed server-side upload with the same signature scheme as
 * api/_cloudinary-sign.js (sorted params + api secret, SHA-1). Returns null —
 * never throws — when Cloudinary isn't configured or the upload fails: losing
 * the photo must not lose the expense.
 */
import crypto from 'node:crypto';

const FOLDER = 'omni/receipts';

/**
 * @param {{base64:string, mimeType:string}} file
 * @param {{orgId:string, ref:string}} meta   ref = stable source id (dedupes re-uploads)
 * @returns {Promise<string|null>} secure URL, or null
 */
export async function storeReceipt(file, { orgId, ref }) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret || !file?.base64) return null;

  const isPdf = file.mimeType === 'application/pdf';
  const resourceType = isPdf ? 'raw' : 'image';
  const publicId = `${orgId}_${String(ref || crypto.randomUUID()).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120)}`;
  const timestamp = Math.floor(Date.now() / 1000);

  const params = { folder: FOLDER, overwrite: 'false', public_id: publicId, timestamp };
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  const signature = crypto.createHash('sha1').update(toSign + apiSecret).digest('hex');

  const form = new FormData();
  form.append('file', `data:${file.mimeType || 'image/jpeg'};base64,${file.base64}`);
  form.append('api_key', apiKey);
  form.append('timestamp', String(timestamp));
  form.append('folder', FOLDER);
  form.append('public_id', publicId);
  form.append('overwrite', 'false');
  form.append('signature', signature);

  try {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(20000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      // "already exists" means an earlier run stored it — fine, rebuild its URL.
      if (/already exists/i.test(json?.error?.message || '')) {
        return `https://res.cloudinary.com/${cloudName}/${resourceType}/upload/${FOLDER}/${publicId}`;
      }
      console.warn('[receipt-store] upload failed', res.status, json?.error?.message);
      return null;
    }
    return json.secure_url || null;
  } catch (err) {
    console.warn('[receipt-store] upload error', err?.message || err);
    return null;
  }
}
