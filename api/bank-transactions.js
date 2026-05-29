// Fetches posted transactions for all accounts in a Salt Edge connection
// POST body: { connection_id }
// Returns: { transactions: [...], accounts: [...] }

import { requireUser } from './_lib/require-auth.js';

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

  const { SALTEDGE_APP_ID, SALTEDGE_SECRET } = process.env;
  if (!SALTEDGE_APP_ID || !SALTEDGE_SECRET) {
    return res.status(500).json({ error: 'Salt Edge credentials not configured' });
  }

  const headers = { 'App-id': SALTEDGE_APP_ID, 'Secret': SALTEDGE_SECRET };

  try {
    // Get accounts for this connection
    const acctRes  = await fetch(`${BASE}/accounts?connection_id=${connection_id}`, { headers });
    const acctData = await acctRes.json();
    const accounts = acctData.data || [];

    // Fetch transactions per account (Salt Edge paginates; fetch first page per account)
    const allTransactions = [];
    for (const account of accounts) {
      let url = `${BASE}/transactions?connection_id=${connection_id}&account_id=${account.id}`;
      while (url) {
        const txRes  = await fetch(url, { headers });
        const txData = await txRes.json();
        const txs    = (txData.data || []).map((tx) => ({ ...tx, accountId: account.id }));
        allTransactions.push(...txs);
        // Follow next_id pagination
        url = txData.meta?.next_id
          ? `${BASE}/transactions?connection_id=${connection_id}&account_id=${account.id}&from_id=${txData.meta.next_id}`
          : null;
      }
    }

    return res.status(200).json({ transactions: allTransactions, accounts });
  } catch (err) {
    console.error('[bank-transactions]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
