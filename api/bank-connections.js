// Lists active connections for a Salt Edge customer
// GET ?customer_id=...
// Returns: { connections: [{ id, provider_name, status }] }

const BASE = 'https://www.saltedge.com/api/v6';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { customer_id } = req.query;
  if (!customer_id) return res.status(400).json({ error: 'customer_id required' });

  const { SALTEDGE_APP_ID, SALTEDGE_SECRET } = process.env;
  if (!SALTEDGE_APP_ID || !SALTEDGE_SECRET) {
    return res.status(500).json({ error: 'Salt Edge credentials not configured' });
  }

  try {
    const headers = { 'App-id': SALTEDGE_APP_ID, 'Secret': SALTEDGE_SECRET };
    const connRes  = await fetch(`${BASE}/connections?customer_id=${customer_id}`, { headers });
    const connData = await connRes.json();
    return res.status(200).json({ connections: connData.data || [] });
  } catch (err) {
    console.error('[bank-connections]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
