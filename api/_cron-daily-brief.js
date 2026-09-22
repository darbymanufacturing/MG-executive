/**
 * api/cron-daily-brief.js — the 07:00 (Athens) daily brief, generated on the
 * server whether or not anyone opens the app. Autopilot Phase 4
 * (docs/AUTOMATION_PLAN.md).
 *
 * Until 2026-09-22 this was an acknowledged stub: the brief only existed if
 * someone opened Home, because payload aggregation lived in a React component.
 * Now the pieces are shared instead of copied:
 *   - src/utils/briefPayload.js     — the SAME payload builder the Home page uses
 *   - src/utils/financialSummary.js — the SAME numbers hub (ADR-0024) for MTD money
 *   - api/_daily-brief.js generateBrief — the SAME prompt, model and sanitizer
 * so the scheduled brief and the on-open brief can never disagree.
 *
 * Output:
 *   1. briefs/{org}_{date}_{uid} in Firestore for every admin/owner — exactly the
 *      document DailyBrief.jsx reads first, so Home shows it instantly.
 *   2. Optionally a WhatsApp message via an approved template (WHATSAPP_BRIEF_TEMPLATE);
 *      business-initiated messages can only be templates.
 *
 * Cost guard: ONE model call per day for the whole org (the payload is org-wide).
 * Idempotent: an existing brief for today is kept unless ?force=1.
 *
 * Trigger: Vercel cron 05:00 UTC (07:00/08:00 Athens) with Bearer CRON_SECRET,
 * or an admin manually.
 */
import { requireCronOrUser, requireOrgMember } from './_lib/require-auth.js';
import { supabaseAdmin } from './_lib/supabase-admin.js';
import { getDb } from './_lib/firebase-admin.js';
import { heartbeatOk, heartbeatFail } from './_lib/heartbeat.js';
import { intakeOrgId } from './_lib/intake-store.js';
import { sendTemplate, briefRecipients } from './_lib/whatsapp.js';
import { generateBrief } from './_daily-brief.js';
import { SUPABASE_TABLE } from '../src/lib/supabaseRowMap.js';
import { orgDocId } from '../src/utils/orgDocId.js';
import { buildBriefPayload } from '../src/utils/briefPayload.js';
import { financialSummary } from '../src/utils/financialSummary.js';

const HEARTBEAT_ENV = 'HEARTBEAT_DAILY_BRIEF';
const DAY_MS = 86_400_000;
const TERMINAL = new Set(['Completed', 'Donor']);

async function load(supa, table, orgId) {
  const { data, error } = await supa.from(table).select('source_doc_id, data').eq('org_id', orgId);
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data || []).map((r) => ({ ...(r.data || {}), _docId: r.source_doc_id }));
}

/** Tolerant loader for tables that may not exist yet (e.g. intake_items before its migration). */
async function loadOptional(supa, table, orgId) {
  try { return await load(supa, table, orgId); } catch { return []; }
}

const daysBetween = (fromIso, toIso) => {
  const a = Date.parse(`${String(fromIso).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(toIso).slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / DAY_MS)) : 0;
};

/** Everything the brief needs, derived exactly the way the in-app contexts derive it. */
export function buildServerContexts({ costs, revenue, scooters, tickets, issues, projects, config }, now = new Date()) {
  const nowIso = now.toISOString();
  const today = nowIso.slice(0, 10);

  const activeIssues = issues.filter((i) =>
    i.status !== 'done' && !(i.status === 'snoozed' && i.snoozeUntil && i.snoozeUntil > nowIso));

  const ticketsWithDays = tickets.map((t) => ({
    ...t,
    daysOpen: TERMINAL.has(t.status)
      ? daysBetween(t.dateEntered, t.dateCompleted || today)
      : daysBetween(t.dateEntered, today),
  }));

  return {
    issueCtx: { activeIssues },
    maintenanceCtx: { tickets: ticketsWithDays, scooters },
    projectCtx: { projects, activeProjects: projects.filter((p) => !p.archived) },
    revenueCtx: { revenueData: revenue },
    costsCtx: { costs, config },
  };
}

/** Feed health for the "Automation" lines of the brief. */
export function feedHealthFrom({ revenue, intake, tickets }, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const lastRevenue = revenue.map((r) => r.date).filter(Boolean).sort().pop() || null;
  return {
    revenueLastDate: lastRevenue,
    revenueDaysStale: lastRevenue ? daysBetween(lastRevenue, today) : null,
    pendingReview: intake.filter((i) => i.status === 'pending').length,
    dueTicketsToday: tickets.filter((t) => t.source === 'autopilot-schedule' && t.dateEntered === today).length,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const auth = await requireCronOrUser(req, res);
  if (!auth) return;

  const force = req.query?.force === '1';
  const orgId = intakeOrgId();
  if (!requireOrgMember(auth, orgId, res)) return;
  const now = new Date();
  const date = now.toISOString().slice(0, 10);

  try {
    if (!process.env.ANTHROPIC_KEY) throw new Error('ANTHROPIC_KEY not configured');

    const supa = supabaseAdmin();
    const [costs, revenue, scooters, tickets, issues, projects, users, configRows, intake] = await Promise.all([
      load(supa, SUPABASE_TABLE.costs, orgId),
      load(supa, SUPABASE_TABLE.revenue, orgId),
      load(supa, SUPABASE_TABLE.scooters, orgId),
      load(supa, SUPABASE_TABLE.maintenanceTickets, orgId),
      load(supa, SUPABASE_TABLE.issues, orgId),
      load(supa, SUPABASE_TABLE.projects, orgId),
      load(supa, SUPABASE_TABLE.users, orgId),
      load(supa, SUPABASE_TABLE.config, orgId),
      loadOptional(supa, 'intake_items', orgId),
    ]);

    const config = configRows.find((c) => c._docId === `${orgId}_fleet`) || {};

    // Canonical month-to-date money from the numbers hub (ADR-0024).
    const monthKey = date.slice(0, 7);
    const mtd = financialSummary(costs, revenue, scooters, config, { mode: 'month', monthKey, months: 1 }, { now });

    const contexts = buildServerContexts({ costs, revenue, scooters, tickets, issues, projects, config }, now);
    const { dataIsVoid, payload } = buildBriefPayload(contexts, now, mtd);

    if (dataIsVoid) {
      // Same short-circuit as the Home page: an all-zero day means a stalled
      // pipeline, and narrating zeros would be confidently wrong.
      await heartbeatFail(HEARTBEAT_ENV, 'data is void — every feed reads zero');
      return res.status(200).json({ ok: false, skipped: 'data-void', date });
    }

    payload.feedHealth = feedHealthFrom({ revenue, intake, tickets }, now);

    const recipients = users.filter((u) => u.role === 'admin' || u.role === 'owner' || u.isOwner);
    const db = getDb();
    const keys = recipients.map((u) => ({ uid: u._docId, key: orgDocId(orgId, `${date}_${u._docId}`) }));

    // Idempotency: keep a brief that already exists today (someone opened Home
    // early, or this cron already ran) unless forced.
    const existing = force ? [] : await Promise.all(keys.map(({ key }) => db.collection('briefs').doc(key).get()));
    const missing = keys.filter((_, i) => force || !existing[i]?.exists);

    let generated = null;
    if (missing.length || force) {
      generated = await generateBrief(date, payload);
      await Promise.all(missing.map(({ uid, key }) => db.collection('briefs').doc(key).set({
        userId: uid,
        orgId,
        date,
        narrative: generated.narrative,
        sections: generated.sections,
        generatedAt: generated.generatedAt,
        source: 'cron',
      })));
    }

    // WhatsApp — only with an approved template (Meta rule for unprompted messages).
    let whatsappSent = 0;
    const template = process.env.WHATSAPP_BRIEF_TEMPLATE;
    if (template && generated?.narrative) {
      for (const to of briefRecipients()) {
        if (await sendTemplate(to, template, [generated.narrative], process.env.WHATSAPP_BRIEF_LANG || 'en')) whatsappSent += 1;
      }
    }

    await heartbeatOk(HEARTBEAT_ENV, `briefs=${missing.length} whatsapp=${whatsappSent}`);
    return res.status(200).json({
      ok: true,
      date,
      written: missing.length,
      kept: keys.length - missing.length,
      whatsappSent,
      trigger: auth.trigger,
    });
  } catch (err) {
    const message = err?.message || String(err);
    console.error('[cron-daily-brief]', message);
    await heartbeatFail(HEARTBEAT_ENV, message.slice(0, 200));
    return res.status(500).json({ ok: false, error: message });
  }
}
