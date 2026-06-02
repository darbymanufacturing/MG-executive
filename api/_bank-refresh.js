// Triggers a Salt Edge connection refresh and re-fetches transactions
// POST body: { connection_id }
// Returns: { transactions: [...] }

import { requireUser } from './_lib/require-auth.js';
import { getDb } from './_lib/firebase-admin.js';

const BASE = 'https://www.saltedge.com/api/v6';
const SAFE_ID = /^[A-Za-z0-9_-]+$/; // #17 — keep user-supplied IDs out of the request URL

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // #16 — banking data: require a signed-in admin/staff user (was publicly callable).
  const authUser = await requireUser(req, res, { roles: ['admin', 'staff', 'owner'] });
  if (!authUser) return;

  const { connection_id } = req.body || {};
  if (!connection_id) return res.status(400).json({ error: 'connection_id required' });
  if (!SAFE_ID.test(String(connection_id))) return res.status(400).json({ error: 'Invalid connection_id' });

  // #30 — verify connection_id belongs to this deployment's stored bank config
  try {
    const bankCfg = await getDb().doc('config/bank').get();
    if (!bankCfg.exists) return res.status(403).json({ error: 'No bank connection configured' });
    const stored = bankCfg.data().connectionId;
    if (stored && stored !== connection_id) {
      return res.status(403).json({ error: 'connection_id does not match stored connection' });
    }
  } catch (err) {
    console.error('[bank-refresh] config/bank read failed', err.message);
    return res.status(500).json({ error: 'Could not verify bank connection' });
  }

  const { SALTEDGE_APP_ID, SALTEDGE_SECRET } = process.env;
  if (!SALTEDGE_APP_ID || !SALTEDGE_SECRET) {
    return res.status(500).json({ error: 'Salt Edge credentials not configured' });
  }

  const headers     = { 'App-id': SALTEDGE_APP_ID, 'Secret': SALTEDGE_SECRET };
  const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };

  try {
    // Trigger async refresh (Salt Edge fetches new data in background)
    await fetch(`${BASE}/connections/${connection_id}/refresh`, {
      method:  'PUT',
      headers: jsonHeaders,
      body:    JSON.stringify({ data: {} }),
    });

    // Re-fetch accounts and transactions (returns current data; refresh may still be in progress)
    const acctRes  = await fetch(`${BASE}/accounts?connection_id=${connection_id}`, { headers, signal: AbortSignal.timeout(10_000) });
    const acctData = await acctRes.json();
    const accounts = acctData.data || [];

    const MAX_PAGES = 50;
    const allTransactions = [];
    for (const account of accounts) {
      let url = `${BASE}/transactions?connection_id=${connection_id}&account_id=${account.id}`;
      let pages = 0;
      while (url && pages++ < MAX_PAGES) {
        const txRes  = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
        const txData = await txRes.json();
        const txs    = (txData.data || []).map((tx) => ({ ...tx, accountId: account.id }));
        allTransactions.push(...txs);
        url = txData.meta?.next_id
          ? `${BASE}/transactions?connection_id=${connection_id}&account_id=${account.id}&from_id=${txData.meta.next_id}`
          : null;
      }
    }

    return res.status(200).json({ transactions: allTransactions });
  } catch (err) {
    console.error('[bank-refresh]', err.message);
    return res.status(500).json({ error: 'Bank data refresh failed' });
  }
}
