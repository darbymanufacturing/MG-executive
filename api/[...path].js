/**
 * api/[...path].js — single catch-all Vercel Serverless Function (function-count fix).
 *
 * Vercel Hobby caps a deployment at 12 Serverless Functions. The app has 19 API
 * endpoints, which made every deploy of this branch ERROR at the function-provisioning
 * stage. Fix: each real handler now lives in an underscore-prefixed module
 * (`api/_<name>.js`) which Vercel does NOT deploy as its own function, and THIS one
 * catch-all dispatches to them by URL path. Public URLs are unchanged
 * (e.g. /api/bank-connections, /api/cron-hopp-sync still resolve here), so there are
 * NO client- or cron-caller changes. `config.maxDuration` covers the longest handler.
 *
 * Adding a new endpoint = add a module `api/_foo.js` + one line to ROUTES. The
 * function count stays at 1 regardless of how many endpoints exist.
 */
import acceptInvite from './_accept-invite.js';
import accountantForward from './_accountant-forward.js';
import bankConnections from './_bank-connections.js';
import bankRefresh from './_bank-refresh.js';
import bankSession from './_bank-session.js';
import bankTransactions from './_bank-transactions.js';
import cloudinaryDelete from './_cloudinary-delete.js';
import cloudinarySign from './_cloudinary-sign.js';
import createInvite from './_create-invite.js';
import cronDailyBrief from './_cron-daily-brief.js';
import cronHoppSync from './_cron-hopp-sync.js';
import cronPurgeDeletedOrgs from './_cron-purge-deleted-orgs.js';
import cronSupabaseParityCheck from './_cron-supabase-parity-check.js';
import dailyBrief from './_daily-brief.js';
import deleteAccount from './_delete-account.js';
import deleteUser from './_delete-user.js';
import diaryParse from './_diary-parse.js';
import invoiceParse from './_invoice-parse.js';
import syncClaim from './_sync-claim.js';

// URL path segment (after /api/) → handler. Keys MUST match the old filenames so
// every existing URL keeps working unchanged.
const ROUTES = {
  'accept-invite': acceptInvite,
  'accountant-forward': accountantForward,
  'bank-connections': bankConnections,
  'bank-refresh': bankRefresh,
  'bank-session': bankSession,
  'bank-transactions': bankTransactions,
  'cloudinary-delete': cloudinaryDelete,
  'cloudinary-sign': cloudinarySign,
  'create-invite': createInvite,
  'cron-daily-brief': cronDailyBrief,
  'cron-hopp-sync': cronHoppSync,
  'cron-purge-deleted-orgs': cronPurgeDeletedOrgs,
  'cron-supabase-parity-check': cronSupabaseParityCheck,
  'daily-brief': dailyBrief,
  'delete-account': deleteAccount,
  'delete-user': deleteUser,
  'diary-parse': diaryParse,
  'invoice-parse': invoiceParse,
  'sync-claim': syncClaim,
};

// Hobby max is 60s; covers the longest handler (cron-hopp-sync, daily-brief AI calls).
export const config = { maxDuration: 60 };

export default function handler(req, res) {
  // Vercel populates the catch-all segments at req.query.path (array) for [...path].js.
  const seg = req.query?.path;
  const name = Array.isArray(seg) ? seg.join('/') : (seg || '');
  const route = ROUTES[name];
  if (!route) {
    res.status(404).json({ error: `Unknown API route: ${name || '(root)'}` });
    return;
  }
  return route(req, res);
}
