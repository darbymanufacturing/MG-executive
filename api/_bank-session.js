// Creates a Salt Edge connect session for bank linking
// POST body: { customer_id?, redirect_url? }
// Returns: { connect_url, customer_id }
// Env vars: SALTEDGE_APP_ID, SALTEDGE_SECRET

import { requireUser } from './_lib/require-auth.js';

const BASE = 'https://www.saltedge.com/api/v6';
const SAFE_ID = /^[A-Za-z0-9_-]+$/; // #17

function seHeaders() {
  return {
    'App-id':        process.env.SALTEDGE_APP_ID,
    'Secret':        process.env.SALTEDGE_SECRET,
    'Content-Type':  'application/json',
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // #16 — banking link flow: require a signed-in admin/staff user (was publicly callable).
  const authUser = await requireUser(req, res, { roles: ['admin', 'staff', 'owner'] });
  if (!authUser) return;

  const { SALTEDGE_APP_ID, SALTEDGE_SECRET } = process.env;
  if (!SALTEDGE_APP_ID || !SALTEDGE_SECRET) {
    return res.status(500).json({ error: 'Salt Edge credentials not configured (SALTEDGE_APP_ID / SALTEDGE_SECRET)' });
  }

  let { customer_id, redirect_url } = req.body || {};
  if (customer_id && !SAFE_ID.test(String(customer_id))) {
    return res.status(400).json({ error: 'Invalid customer_id' });
  }
  // #89/#17 — env-var origin; only honor a caller-supplied redirect_url if it points
  // at our own origin (prevents open-redirect / host-header injection).
  // Use URL-parsed origin equality (not startsWith) to prevent subdomain confusion:
  // e.g. https://omni.mgexecutive.app.evil.com starts with our origin string but
  // has a different parsed origin.
  const origin = process.env.APP_ORIGIN || 'https://omni.mgexecutive.app';
  let redirectTo = `${origin}/settings`;
  if (redirect_url) {
    try {
      const u = new URL(redirect_url);
      if (u.origin === origin) redirectTo = redirect_url;
    } catch {
      // malformed URL — fall through to default
    }
  }

  try {
    // 1. Create customer if this is the first connect
    if (!customer_id) {
      const custRes  = await fetch(`${BASE}/customers`, {
        method:  'POST',
        headers: seHeaders(),
        body:    JSON.stringify({ data: { identifier: `xslide-${Date.now()}` } }),
      });
      const custData = await custRes.json();
      if (!custData.data?.id) throw new Error(`Customer error: ${JSON.stringify(custData)}`);
      customer_id = custData.data.id;
    }

    // 2. Create connect session (90 days of history)
    const from_date = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const sessionRes = await fetch(`${BASE}/connect_sessions/create`, {
      method:  'POST',
      headers: seHeaders(),
      body:    JSON.stringify({
        data: {
          customer_id,
          consent: {
            scopes:    ['account_details', 'transactions_details'],
            from_date,
          },
          attempt: {
            return_to:         redirectTo,
            store_credentials: true,
          },
        },
      }),
    });
    const sessionData = await sessionRes.json();
    if (!sessionData.data?.connect_url) throw new Error(`Session error: ${JSON.stringify(sessionData)}`);

    return res.status(200).json({ connect_url: sessionData.data.connect_url, customer_id });
  } catch (err) {
    console.error('[bank-session]', err.message);
    return res.status(500).json({ error: 'Bank session error' });
  }
}
