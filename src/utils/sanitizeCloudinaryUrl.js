/**
 * Returns the URL unchanged if it is a valid Cloudinary delivery URL
 * (i.e. starts with https://res.cloudinary.com/), otherwise returns null.
 *
 * This is the single allowlist gate for photo URLs rendered as clickable
 * links in RepairSessionFeed. Removing the <a> wrapper for non-Cloudinary
 * URLs closes the malicious-link navigation vector described in bug #205.
 *
 * @param {*} url
 * @returns {string|null}
 */
export function sanitizeCloudinaryUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return null;
  if (url.startsWith('https://res.cloudinary.com/')) return url;
  return null;
}
