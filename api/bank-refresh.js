// Re-fetches latest booked transactions for a specific account
// POST body: { account_id }
// Returns: { transactions: [...] }

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

  const { account_id } = req.body || {};
  if (!account_id) {
    return res.status(400).json({ error: 'account_id is required' });
  }

  try {
    const token = await getToken(GOCARDLESS_SECRET_ID, GOCARDLESS_SECRET_KEY);
    const headers = { Authorization: `Bearer ${token}` };

    const txRes = await fetch(`${BASE}/accounts/${account_id}/transactions/`, { headers });
    const txData = await txRes.json();
    const transactions = (txData.transactions?.booked || []).map((tx) => ({ ...tx, accountId: account_id }));

    return res.status(200).json({ transactions });
  } catch (err) {
    console.error('[bank-refresh]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
