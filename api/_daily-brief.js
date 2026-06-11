/**
 * api/daily-brief.js — Generate a Claude-narrated daily brief.
 *
 * POST /api/daily-brief
 * Body (JSON):
 *   {
 *     userId: string,
 *     date: "YYYY-MM-DD",
 *     data: {
 *       openIssues:        [{ title, urgency, type, nextAction }],
 *       overdueTickets:    [{ issueDescription, daysOpen, status }],
 *       activeTickets:     number,
 *       completedToday:    number,
 *       openProjects:      [{ name, status, blockers }],
 *       revenueThisWeek:   number,       // EUR
 *       revenuePrevWeek:   number,       // EUR
 *       costsThisMonth:    number,       // EUR
 *       criticalIssues:    number,
 *       fleetSize:         number,
 *       inRepair:          number,
 *     }
 *   }
 *
 * Returns:
 *   { narrative, sections: [{title, items:[]}], generatedAt }
 */

import Anthropic from '@anthropic-ai/sdk';
import { requireUser } from './_lib/require-auth.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });

/**
 * BUG #604 — Opus 4.8 occasionally streams its own tool-use XML format
 * (`</parameter> <parameter name="sections">...`) INTO the narrative string
 * parameter, polluting the user-facing brief. The SDK parses the JSON cleanly,
 * but the narrative field arrives containing those literal tags. Strip anything
 * from the first tool-use control token onward; the sections array comes through
 * the structured `parsed.sections` path and is unaffected.
 */
const TOOL_USE_LEAK_PATTERN = /<\/?(parameter|invoke|antml:parameter|antml:invoke|antml:function_calls|function_calls)\b[\s\S]*$/i;
export function sanitizeNarrative(narrative) {
  if (typeof narrative !== 'string') return '';
  return narrative.replace(TOOL_USE_LEAK_PATTERN, '').trim();
}

function buildPrompt(date, data) {
  const {
    openIssues = [], overdueTickets = [], activeTickets = 0, completedToday = 0,
    openProjects = [], revenueThisWeek = 0, revenuePrevWeek = 0,
    costsThisMonth = 0, criticalIssues = 0, fleetSize = 0, inRepair = 0,
  } = data;

  // Defense-in-depth: coerce the array fields so a malformed payload (e.g. a count
  // sent where an array is expected) can never throw a TypeError → 500.
  const issuesArr   = Array.isArray(openIssues)   ? openIssues   : [];
  const projectsArr = Array.isArray(openProjects) ? openProjects : [];

  const revChange = revenuePrevWeek > 0
    ? (((revenueThisWeek - revenuePrevWeek) / revenuePrevWeek) * 100).toFixed(1)
    : null;

  const criticalIssuesList = issuesArr.filter(i => i.urgency === 'critical' || i.urgency === 'high');
  const blockedProjects = projectsArr.filter(p => p.blockers?.length > 0 || p.status === 'Red');

  return `Today is ${date}. Generate a concise daily operational brief for the founder of a Greek micromobility company (Omni platform).

OPERATIONAL DATA:
- Fleet: ${fleetSize} scooters total, ${inRepair} in repair (${fleetSize > 0 ? ((inRepair/fleetSize)*100).toFixed(0) : 0}% offline)
- Revenue this week: €${revenueThisWeek.toLocaleString()}${revChange ? ` (${revChange > 0 ? '+' : ''}${revChange}% vs last week)` : ''}
- Costs this month: €${costsThisMonth.toLocaleString()}
- Maintenance: ${activeTickets} active tickets, ${overdueTickets.length} overdue (>7 days), ${completedToday} closed today
- Issues: ${issuesArr.length} open (${criticalIssues} critical/high)
${criticalIssuesList.length ? `- Critical/high issues:\n${criticalIssuesList.slice(0, 3).map(i => `  • [${i.urgency.toUpperCase()}] ${i.title}${i.nextAction ? ` → ${i.nextAction}` : ''}`).join('\n')}` : ''}
${blockedProjects.length ? `- Blocked projects:\n${blockedProjects.slice(0, 2).map(p => `  • ${p.name}${p.blockers?.[0]?.text ? `: ${p.blockers[0].text.slice(0, 60)}` : ''}`).join('\n')}` : ''}
${overdueTickets.length ? `- Most overdue tickets:\n${overdueTickets.slice(0, 2).map(t => `  • ${t.issueDescription?.slice(0, 60)} (${t.daysOpen}d)`).join('\n')}` : ''}

Use the daily_brief tool to return the structured brief.

IMPORTANT FORMATTING RULES (#604):
- The "narrative" field must contain ONLY plain English prose. Do NOT include any XML tags, <parameter> declarations, JSON, brackets, or tool-call formatting inside the narrative string. The narrative ends at the final full stop of your 2-3 sentence summary — anything after that belongs in the "sections" field.
- For the narrative: write 2-3 sentences summarising the key operational state and the biggest thing needing attention today. Mention any trend (revenue up/down, fleet availability, etc.). Be direct, not flowery.
- For sections: keep each items entry concise (under 80 chars). Max 3 items per section. Omit sections with no meaningful content.`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // #16 — require a signed-in user (was publicly callable → anonymous Opus spend).
  const authUser = await requireUser(req, res);
  if (!authUser) return;

  if (!process.env.ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });
  }

  const { userId, date, data } = req.body || {};

  if (!userId || !date || !data) {
    return res.status(400).json({ error: 'userId, date, and data are required' });
  }

  try {
    const message = await client.messages.create({
      // Opus 4.8 for sharper "needs attention today" judgment — at one brief/day this is ~€37/yr per client (negligible).
      // CORRECTNESS INVARIANT: every number is pre-computed in buildPrompt(); the model only narrates. Never hand it raw
      // rows to total up — that's where hallucinated figures come from. See docs/SCALING.md §13.
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      tools: [{
        name: 'daily_brief',
        description: 'Return the structured daily operational brief.',
        input_schema: {
          type: 'object',
          properties: {
            narrative: {
              type: 'string',
              description: '2-3 sentence plain English summary of key operational state and biggest thing needing attention today.',
            },
            sections: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  items: { type: 'array', items: { type: 'string' } },
                },
                required: ['title', 'items'],
              },
            },
          },
          required: ['narrative', 'sections'],
        },
      }],
      tool_choice: { type: 'tool', name: 'daily_brief' },
      messages: [{ role: 'user', content: buildPrompt(date, data) }],
    });

    const toolUse = message.content.find(b => b.type === 'tool_use' && b.name === 'daily_brief');
    if (!toolUse) {
      return res.status(200).json({
        narrative: 'Brief generation encountered a formatting issue. Check the app for details.',
        sections: [],
        generatedAt: new Date().toISOString(),
        error: 'No tool_use block returned',
      });
    }
    const parsed = toolUse.input;

    return res.status(200).json({
      // #604 — strip Opus 4.8's tool-use XML leakage from the narrative string.
      narrative: sanitizeNarrative(parsed.narrative),
      sections: parsed.sections || [],
      generatedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('daily-brief error:', err);
    return res.status(500).json({ error: 'Brief generation failed' });
  }
}
