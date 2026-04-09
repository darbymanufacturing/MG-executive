// Fetches booked transactions for all accounts in a requisition
// POST body: { requisition_id }
// Returns: { transactions: [...], account_ids: [...] }

const BASE = 'https://bankaccountdata.gocardless.com/api/v2';

async function getToken(secretId, secretKey) {
  const res = await fetch(`${BASE}/token/new/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret_id: secretId, secret_key: secretKey }),
  });
  const data = await res.json();
  if (!data.access) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { GOCARDLESS_SECRET_ID, GOCARDLESS_SECRET_KEY } = process.env;
  if (!GOCARDLESS_SECRET_ID || !GOCARDLESS_SECRET_KEY) {
    return res.status(500).json({ error: 'GoCardless credentials not configured' });
  }

  const { requisition_id } = req.body || {};
  if (!requisition_id) {
    return res.status(400).json({ error: 'requisition_id is required' });
  }

  try {
    const token = await getToken(GOCARDLESS_SECRET_ID, GOCARDLESS_SECRET_KEY);
    const headers = { Authorization: `Bearer ${token}` };

    // Get account list from requisition
    const reqRes = await fetch(`${BASE}/requisitions/${requisition_id}/`, { headers });
    const requisition = await reqRes.json();
    const accountIds = requisition.accounts || [];

    if (accountIds.length === 0) {
      return res.status(200).json({ transactions: [], account_ids: [] });
    }

    // Fetch transactions for each account
    const allTransactions = [];
    for (const accountId of accountIds) {
      const txRes = await fetch(`${BASE}/accounts/${accountId}/transactions/`, { headers });
      const txData = await txRes.json();
      const booked = (txData.transactions?.booked || []).map((tx) => ({ ...tx, accountId }));
      allTransactions.push(...booked);
    }

    return res.status(200).json({ transactions: allTransactions, account_ids: accountIds });
  } catch (err) {
    console.error('[bank-transactions]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
