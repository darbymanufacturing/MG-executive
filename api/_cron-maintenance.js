/**
 * api/cron-maintenance.js — daily maintenance autopilot (docs/AUTOMATION_PLAN.md
 * Phase 3). Runs whether or not anyone opens the app.
 *
 *   1. Every preventive schedule that is due (or overdue) and has no open ticket
 *      becomes a ticket — the owner no longer clicks "Ticket" on the due date.
 *   2. Every scooter's status is reconciled with its tickets: open ticket →
 *      "In Repair", none open → "Active". This is also the safety net for
 *      repairs closed through the crew app, whose atomic completion writer
 *      (repairSessionWriter) deliberately stays untouched.
 *
 * Both rules come from src/utils/maintenanceAutomation.js — the same pure
 * functions the in-app actions use, so the robot and the UI agree.
 *
 * Trigger: Vercel cron (Bearer CRON_SECRET) or an admin, manually.
 */
import { requireCronOrUser } from './_lib/require-auth.js';
import { supabaseAdmin } from './_lib/supabase-admin.js';
import { heartbeatOk, heartbeatFail } from './_lib/heartbeat.js';
import { intakeOrgId } from './_lib/intake-store.js';
import { SUPABASE_TABLE } from '../src/lib/supabaseRowMap.js';
import { orgDocId } from '../src/utils/orgDocId.js';
import { dueScheduleTickets, scooterStatusAfter } from '../src/utils/maintenanceAutomation.js';

const HEARTBEAT_ENV = 'HEARTBEAT_MAINTENANCE';
const MAX_NEW_TICKETS = 50; // a runaway schedule table must not flood the backlog

async function loadDocs(supa, table, orgId) {
  const { data, error } = await supa
    .from(table)
    .select('source_doc_id, data')
    .eq('org_id', orgId);
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data || []).map((r) => ({ ...(r.data || {}), _docId: r.source_doc_id }));
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const auth = await requireCronOrUser(req, res);
  if (!auth) return;

  const orgId = intakeOrgId();
  const today = new Date().toISOString().slice(0, 10);
  const report = { date: today, ticketsRaised: 0, scootersUpdated: 0, errors: [] };

  try {
    const supa = supabaseAdmin();
    const [schedules, tickets, scooters] = await Promise.all([
      loadDocs(supa, SUPABASE_TABLE.maintenanceSchedules, orgId),
      loadDocs(supa, SUPABASE_TABLE.maintenanceTickets, orgId),
      loadDocs(supa, SUPABASE_TABLE.scooters, orgId),
    ]);

    /* 1 — due preventive schedules → tickets */
    const due = dueScheduleTickets(schedules, tickets, today).slice(0, MAX_NEW_TICKETS);
    const usedIds = new Set(tickets.map((t) => t._docId));
    for (const draft of due) {
      if (!draft.scooterId) continue;
      // Same deterministic id + collision suffix as MaintenanceContext.addTicket.
      const baseId = orgDocId(orgId, draft.scooterId, draft.dateEntered);
      let docId = baseId;
      let n = 1;
      while (usedIds.has(docId)) docId = `${baseId}_${++n}`;
      usedIds.add(docId);

      const scooter = scooters.find((s) => String(s.scooterId) === draft.scooterId);
      const data = {
        ...draft,
        city: scooter?.city || '',
        orgId,
        createdByUid: 'autopilot',
        createdAt: new Date().toISOString(),
      };
      const { error } = await supa
        .from(SUPABASE_TABLE.maintenanceTickets)
        .upsert({ org_id: orgId, source_doc_id: docId, data }, { onConflict: 'source_doc_id' });
      if (error) { report.errors.push(`ticket ${docId}: ${error.message}`); continue; }
      tickets.push({ ...data, _docId: docId });
      report.ticketsRaised += 1;
    }

    /* 2 — scooter status ⇄ tickets */
    for (const scooter of scooters) {
      const next = scooterStatusAfter(scooter, tickets);
      if (!next) continue;
      const { _docId, ...rest } = scooter;
      const { error } = await supa
        .from(SUPABASE_TABLE.scooters)
        .update({
          data: { ...rest, status: next, statusChangedBy: 'autopilot', statusChangedAt: new Date().toISOString() },
        })
        .eq('source_doc_id', _docId);
      if (error) { report.errors.push(`scooter ${scooter.scooterId}: ${error.message}`); continue; }
      report.scootersUpdated += 1;
    }

    if (report.errors.length) {
      await heartbeatFail(HEARTBEAT_ENV, report.errors.slice(0, 3).join(' | '));
    } else {
      await heartbeatOk(HEARTBEAT_ENV, `raised=${report.ticketsRaised} scooters=${report.scootersUpdated}`);
    }
    return res.status(200).json({ ok: report.errors.length === 0, ...report });
  } catch (err) {
    const message = err?.message || String(err);
    console.error('[cron-maintenance]', message);
    await heartbeatFail(HEARTBEAT_ENV, message.slice(0, 200));
    return res.status(500).json({ ok: false, error: message, ...report });
  }
}
