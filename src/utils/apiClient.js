import { auth } from '../lib/firebase.js';

/**
 * authedFetch — fetch() wrapper that attaches the signed-in user's Firebase ID
 * token as a Bearer header, so the serverless endpoints (which now require auth —
 * #16) accept the call. Use for EVERY same-origin `/api/*` call made on behalf of
 * a signed-in user. (Pattern lifted from src/hooks/useHoppSync.js.)
 *
 *   const res = await authedFetch('/api/invoice-parse', {
 *     method: 'POST',
 *     body: JSON.stringify({ imageBase64, mediaType }),
 *   });
 *
 * Sets Content-Type: application/json by default (override via options.headers).
 * Throws if no user is signed in — callers run behind <ProtectedRoute> so this is
 * a programming-error guard, not an expected path.
 */
export async function authedFetch(path, options = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to do this.');
  const token = await user.getIdToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
  };
  return fetch(path, { ...options, headers });
}
