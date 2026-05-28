import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });

const SYSTEM_PROMPT = `You are a data entry assistant for Omni, a Greek micromobility company operations platform.
You receive natural-language diary entries from the operator and convert them into structured data actions.

Return ONLY valid JSON in this exact shape — no markdown, no explanation:
{
  "summary": "one-line description of what this entry does",
  "actions": [
    {
      "module": "scooter|cost|revenue|ticket|part|project|milestone|blocker|update|gate|issue",
      "operation": "add|update|delete",
      "data": { ... }
    }
  ],
  "unresolved": ["list of assumptions made or missing info"]
}

Module data shapes:
- scooter add: { scooterId, city, status("Active"|"In Repair"|"Retired"|"Donor"), purchaseDate(YYYY-MM-DD or null), batteryHealth(0-100 or null) }
- cost add: { name, category("fixed"|"variable"|"loan"|"credit-card"), amount, frequency("monthly"|"weekly"|"annual"|"once"|"daily"|"quarterly"), startDate(YYYY-MM-DD), notes(or null), location(or null) }
- revenue add: { date(YYYY-MM-DD), location, revenue(number), trips(number or null) }
- ticket add: { scooterId, city, dateEntered(YYYY-MM-DD), category("Q"|"M"|"C"|"B"|"F"), status("Active"), primaryTag, issueDescription, notes(or null) }
  ticket categories: Q=Quality, M=Mechanical, C=Cosmetic, B=Battery, F=Fleet
- part add: { sku, name, stockOnHand, reorderPoint, unitCost }
- project add: { name, description, owner("Kostas"|"Panos"|"Both"), status("Green"|"Amber"|"Red"), category("Expansion"|"Operations"|"Technology"|"Finance"|"Legal"), startDate(YYYY-MM-DD or null), targetDate(YYYY-MM-DD or null) }
- milestone add: { projectName(match from context), title, dueDate(YYYY-MM-DD or null) }
- blocker add: { projectName(match from context), text }
- update add: { projectName(match from context), text }
- gate add: { name, question, threshold(number), currentValue(number), unit(string), decisionDate(YYYY-MM-DD or null), status("On Track"|"At Risk") }
- issue add: { title, type("municipality"|"partnership"|"facility"|"regulatory"|"admin"|"finance"|"other"), urgency("low"|"medium"|"high"|"critical"), nextAction(string — single concrete next step), dueDate(YYYY-MM-DD or null), contact(person/org name or null), description(string) }

CRITICAL — use the "issue" module when the entry describes:
- A request, visit, or inspection from a municipality or government body
- A potential or existing hotel / venue / business partnership
- A regulatory concern, permit, or legal matter
- An admin task, financial matter, or general problem that doesn't fit other modules
- An email, phone call, or meeting that needs follow-up
- Anything that doesn't clearly map to a scooter, ticket, cost, revenue, project, or part

Use context.today as today's date. Use context.locations to match city names (fuzzy ok). Use context.projectNames to match project references.
If something is ambiguous, make a reasonable default and add it to unresolved[].`;


function buildPrompt(text, context) {
  return `Context:
- Today: ${context.today}
- Known locations: ${(context.locations || []).join(', ')}
- Known scooter IDs: ${(context.scooterIds || []).slice(0, 20).join(', ')}${context.scooterIds?.length > 20 ? '...' : ''}
- Known projects: ${(context.projectNames || []).join(', ')}

Diary entry:
"${text}"`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, context = {} } = req.body || {};

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'text is required' });
  }

  if (!process.env.ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_KEY not configured on server' });
  }

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildPrompt(text, context) }],
    });

    const raw = message.content[0]?.text || '{}';

    // Strip any accidental markdown fences
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      // Response was truncated or malformed — return what we can with an error note
      console.error('diary-parse JSON error:', parseErr.message, '\nRaw (first 500):', cleaned.slice(0, 500));
      return res.status(200).json({
        summary: 'Parse error — response may have been truncated',
        actions: [],
        unresolved: [`Could not parse AI response: ${parseErr.message}. Try splitting the entry into smaller batches.`],
      });
    }

    // Validate shape
    if (!parsed.actions || !Array.isArray(parsed.actions)) {
      parsed.actions = [];
    }
    if (!parsed.unresolved || !Array.isArray(parsed.unresolved)) {
      parsed.unresolved = [];
    }
    if (!parsed.summary) {
      parsed.summary = 'Diary entry';
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('diary-parse error:', err);
    return res.status(500).json({ error: err.message || 'Parse failed' });
  }
}
