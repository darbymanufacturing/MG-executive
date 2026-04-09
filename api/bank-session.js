// Creates a GoCardless requisition for Alpha Bank (ALPHA_GRAA)
// POST body: { redirect_url }
// Returns: { link, requisition_id }

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
    return res.status(500).json({ error: 'GoCardless credentials not configured in environment variables' });
  }

  const { redirect_url } = req.body || {};
  const redirectTo = redirect_url || `https://${req.headers.host}/settings`;

  try {
    const token = await getToken(GOCARDLESS_SECRET_ID, GOCARDLESS_SECRET_KEY);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // 1. Create end-user agreement (90 days history, 90 days access)
    const agreementRes = await fetch(`${BASE}/agreements/enduser/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        institution_id: 'ALPHA_GRAA',
        max_historical_days: 90,
        access_valid_for_days: 90,
        access_scope: ['balances', 'details', 'transactions'],
      }),
    });
    const agreement = await agreementRes.json();
    if (!agreement.id) throw new Error(`Agreement error: ${JSON.stringify(agreement)}`);

    // 2. Create requisition
    const reqRes = await fetch(`${BASE}/requisitions/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        redirect: redirectTo,
        institution_id: 'ALPHA_GRAA',
        agreement: agreement.id,
        reference: `xslide-${Date.now()}`,
        user_language: 'EN',
      }),
    });
    const requisition = await reqRes.json();
    if (!requisition.link) throw new Error(`Requisition error: ${JSON.stringify(requisition)}`);

    return res.status(200).json({ link: requisition.link, requisition_id: requisition.id });
  } catch (err) {
    console.error('[bank-session]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
