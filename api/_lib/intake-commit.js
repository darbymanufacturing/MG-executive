/**
 * api/_lib/intake-commit.js — approve or reject intake items on the SERVER, for
 * approvals made outside the app (WhatsApp "✅" / "no 2" — owner decision
 * 2026-09-22: approvals in "WhatsApp + Omni").
 *
 * Every record is built by the SAME pure builders the app uses
 * (src/utils/intakeRecords.js, maintenanceAutomation.js), so an item approved
 * from a chat is exactly the record the Review page would have written — same
 * category keys, same ledger/loan rules, same repair costing and stock moves.
 *
 * Writes are idempotent: every record id is derived from the intake item, so a
 * retried approval (Meta re-delivers webhooks) can never create a second cost.
 * Service-role like the rest of Autopilot (no Firebase user behind a webhook);
 * org-scoped on every read and write.
 */
import { SUPABASE_TABLE, toSupabaseRow } from '../../src/lib/supabaseRowMap.js';
import { missingForApproval } from '../../src/utils/intake.js';
import {
  costFromIntake, ledgerFromIntake, issueFromIntake, ISSUE_DEFAULTS, taskFromIntake,
  ticketActionFromIntake, recurringFromIntake, learnedRuleFromApproval, loanPaymentPlan,
} from '../../src/utils/intakeRecords.js';
import {
  planTicketCompletion, ticketDocIdFor, scooterStatusAfter, stockAfterReceipt, matchPartsByName,
} from '../../src/utils/maintenanceAutomation.js';
import { resolveCurrentWeek } from '../../src/utils/powWeek.js';
import { INTAKE_TABLE, commitSettlement } from './intake-store.js';

const iso = () => new Date().toISOString();
const safe = (s) => String(s ?? '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80) || 'x';

/** Deterministic id for a record created from one intake item. */
const recordId = (orgId, kind, item) => `${orgId}_intake_${kind}_${item.source}_${safe(item.sourceRef)}`;

async function loadAll(supa, collection, orgId) {
  const { data, error } = await supa.from(SUPABASE_TABLE[collection]).select('source_doc_id, data').eq('org_id', orgId);
  if (error) throw new Error(`${collection}: ${error.message}`);
  return (data || []).map((r) => ({ ...(r.data || {}), _docId: r.source_doc_id }));
}

async function loadOptional(supa, collection, orgId) {
  try { return await loadAll(supa, collection, orgId); } catch { return []; }
}

/** Create (or idempotently re-create) one document, stamped like the app's sbWrite. */
async function createDoc(supa, collection, orgId, sdid, data, by) {
  const now = iso();
  const stamped = {
    ...data,
    createdByUid: data.createdByUid ?? by,
    createdAt: data.createdAt ?? now,
    updatedAt: now,
  };
  const { error } = await supa
    .from(SUPABASE_TABLE[collection])
    .upsert(toSupabaseRow(collection, orgId, sdid, stamped), { onConflict: 'source_doc_id' });
  if (error) throw new Error(`save ${collection} failed: ${error.message}`);
  return sdid;
}

/** Shallow-merge a patch into one document (the app's orgUpdate semantics). */
async function patchDoc(supa, collection, orgId, sdid, patch) {
  const table = SUPABASE_TABLE[collection];
  const { data: row, error: readErr } = await supa
    .from(table).select('data').eq('org_id', orgId).eq('source_doc_id', sdid).maybeSingle();
  if (readErr) throw new Error(`read ${collection} failed: ${readErr.message}`);
  if (!row) throw new Error(`${collection} ${sdid} not found`);
  const { error } = await supa
    .from(table)
    .update({ data: { ...(row.data || {}), ...patch, updatedAt: iso() } })
    .eq('org_id', orgId).eq('source_doc_id', sdid);
  if (error) throw new Error(`update ${collection} failed: ${error.message}`);
}

/** Everything the committers need to decide what to write. */
export async function loadCommitContext(supa, orgId) {
  const [costs, users, tickets, parts, schedules, scooters, loans, cfg] = await Promise.all([
    loadAll(supa, 'costs', orgId),
    loadOptional(supa, 'users', orgId),
    loadOptional(supa, 'maintenanceTickets', orgId),
    loadOptional(supa, 'maintenanceParts', orgId),
    loadOptional(supa, 'maintenanceSchedules', orgId),
    loadOptional(supa, 'scooters', orgId),
    loadOptional(supa, 'loans', orgId),
    supa.from(SUPABASE_TABLE.config).select('data').eq('source_doc_id', `${orgId}_maintenance`).maybeSingle(),
  ]);
  return {
    costs, users, tickets, parts, schedules, scooters, loans,
    owners: users.filter((u) => u.isOwner || u.role === 'owner'),
    maintenanceConfig: cfg?.data?.data || {},
  };
}

/** The pending queue, OLDEST first — the numbering a WhatsApp digest shows. */
export async function pendingIntake(supa, orgId) {
  const { data, error } = await supa.from(INTAKE_TABLE).select('source_doc_id, data').eq('org_id', orgId);
  if (error) throw new Error(`intake: ${error.message}`);
  return (data || [])
    .map((r) => ({ sdid: r.source_doc_id, item: r.data || {} }))
    .filter((x) => x.item.status === 'pending')
    .sort((a, b) => String(a.item.createdAt || '').localeCompare(String(b.item.createdAt || '')));
}

/** Re-read one item so a stale digest can't approve something already decided. */
async function freshItem(supa, orgId, sdid) {
  const { data } = await supa.from(INTAKE_TABLE).select('data').eq('org_id', orgId).eq('source_doc_id', sdid).maybeSingle();
  return data?.data || null;
}

async function markDecided(supa, orgId, sdid, patch) {
  const { data: row } = await supa.from(INTAKE_TABLE).select('data').eq('org_id', orgId).eq('source_doc_id', sdid).maybeSingle();
  const { error } = await supa.from(INTAKE_TABLE)
    .update({ data: { ...(row?.data || {}), ...patch, updatedAt: iso() } })
    .eq('org_id', orgId).eq('source_doc_id', sdid);
  if (error) throw new Error(`intake update failed: ${error.message}`);
}

/* ── one committer per kind (mirrors IntakeContext) ─────────────────────── */

/* Committers keep `data` current as they write (like ingestBatch does with
 * costs): approving several items in one pass must see the earlier ones — two
 * repairs on the same scooter and day would otherwise compute the same ticket
 * id, and the second would overwrite the first. */

async function commitCostRecord(supa, orgId, item, p, by, data) {
  const sdid = recordId(orgId, 'cost', item);
  const cost = { ...costFromIntake(item, p), id: globalThis.crypto.randomUUID() };
  await createDoc(supa, 'costs', orgId, sdid, cost, by);
  data?.costs?.push({ ...cost, _docId: sdid });
  return sdid;
}

const COMMITTERS = {
  cost: (ctx) => commitCostRecord(ctx.supa, ctx.orgId, ctx.item, ctx.p, ctx.by, ctx.data),

  ledger: async ({ supa, orgId, item, p, by, data }) => {
    const type = p.ledgerType || 'expense_reimbursable';
    const costDocId = type === 'expense_reimbursable' ? await commitCostRecord(supa, orgId, item, p, by, data) : null;
    const owner = data.owners.find((o) => o._docId === p.ownerUid);
    const sdid = recordId(orgId, 'ledger', item);
    await createDoc(supa, 'ownerLedger', orgId, sdid,
      ledgerFromIntake(item, p, { ownerName: owner?.displayName ?? null, costId: costDocId }), by);
    return costDocId || sdid;
  },

  issue: async ({ supa, orgId, item, p, by }) => {
    const sdid = recordId(orgId, 'issue', item);
    await createDoc(supa, 'issues', orgId, sdid,
      { ...ISSUE_DEFAULTS, owner: null, createdBy: by, ...issueFromIntake(item, p) }, by);
    return sdid;
  },

  task: async ({ supa, orgId, item, p, by }) => {
    const sdid = `${orgId}_task-${safe(`${item.source}_${item.sourceRef}`)}`;
    await createDoc(supa, 'pow_tasks', orgId, sdid,
      taskFromIntake(item, p, { week: resolveCurrentWeek(null).computedWeek }), by);
    return sdid;
  },

  ticket: async ({ supa, orgId, item, p, by, data }) => {
    const today = iso().slice(0, 10);
    const action = ticketActionFromIntake(item, p, { tickets: data.tickets, parts: data.parts, scooters: data.scooters, today });
    if (action.action === 'complete') {
      const plan = planTicketCompletion({
        ticket: action.ticket, tickets: data.tickets, parts: data.parts, schedules: data.schedules,
        scooters: data.scooters, config: data.maintenanceConfig, details: action.details, today,
      });
      await patchDoc(supa, 'maintenanceTickets', orgId, action.ticket._docId, plan.ticketPatch);
      Object.assign(action.ticket, plan.ticketPatch);
      for (const s of plan.stock) {
        await patchDoc(supa, 'maintenanceParts', orgId, s.docId, { stockOnHand: s.stockOnHand });
        const part = data.parts.find((x) => x._docId === s.docId);
        if (part) part.stockOnHand = s.stockOnHand;
      }
      if (plan.schedule) await patchDoc(supa, 'maintenanceSchedules', orgId, plan.schedule.docId, plan.schedule.patch);
      if (plan.scooter) {
        await patchDoc(supa, 'scooters', orgId, plan.scooter.docId, {
          status: plan.scooter.status, statusChangedBy: 'autopilot', statusChangedAt: iso(),
        });
        const sc = data.scooters.find((x) => x._docId === plan.scooter.docId);
        if (sc) sc.status = plan.scooter.status;
      }
      return action.ticket._docId;
    }
    const sdid = ticketDocIdFor(orgId, action.data.scooterId, action.data.dateEntered, data.tickets);
    await createDoc(supa, 'maintenanceTickets', orgId, sdid, action.data, by);
    data.tickets.push({ ...action.data, _docId: sdid });
    const scooter = data.scooters.find((s) => String(s.scooterId) === action.data.scooterId);
    const next = scooterStatusAfter(scooter, data.tickets);
    if (next && scooter?._docId) {
      await patchDoc(supa, 'scooters', orgId, scooter._docId, { status: next, statusChangedBy: 'autopilot', statusChangedAt: iso() });
      scooter.status = next;
    }
    return sdid;
  },

  recurring: async ({ supa, orgId, item, p, by }) => {
    const sdid = recordId(orgId, 'recurring', item);
    await createDoc(supa, 'costs', orgId, sdid, { ...recurringFromIntake(item, p), id: globalThis.crypto.randomUUID() }, by);
    return sdid;
  },

  loan_payment: async ({ supa, orgId, item, p, by, data }) => {
    const loan = data.loans.find((l) => l._docId === p.loanId);
    if (!loan) throw new Error('The loan this payment belongs to no longer exists');
    const plan = loanPaymentPlan(item, p, { loan, costs: data.costs });
    if (plan.settle) await commitSettlement(supa, orgId, plan.settle.costId, plan.settle.period);
    if (plan.interestCost) {
      await createDoc(supa, 'costs', orgId, recordId(orgId, 'interest', item),
        { ...plan.interestCost, id: globalThis.crypto.randomUUID() }, by);
    }
    await patchDoc(supa, 'loans', orgId, loan._docId, plan.loanPatch);
    Object.assign(loan, plan.loanPatch);
    return loan._docId;
  },

  parts_receipt: async ({ supa, orgId, p, data }) => {
    const updates = stockAfterReceipt(data.parts, p.parts || []);
    const at = iso();
    for (const u of updates) {
      await patchDoc(supa, 'maintenanceParts', orgId, u.docId, {
        stockOnHand: u.stockOnHand, unitsOnOrder: u.unitsOnOrder, status: u.status, lastReceivedAt: at,
      });
      const part = data.parts.find((x) => x._docId === u.docId);
      if (part) Object.assign(part, { stockOnHand: u.stockOnHand, unitsOnOrder: u.unitsOnOrder, status: u.status });
    }
    return updates.map((u) => u.docId).join(',') || null;
  },
};

/**
 * Approve one pending item on the server.
 * @returns {Promise<string|null>} the committed record's id
 */
export async function approveOnServer(supa, orgId, sdid, overrides = {}, data, { via = 'whatsapp', by = 'autopilot' } = {}) {
  const item = await freshItem(supa, orgId, sdid);
  if (!item) throw new Error('That item no longer exists');
  if (item.status !== 'pending') throw new Error(`Already ${String(item.status).replace('_', ' ')}`);

  // A parts delivery reported in words ("10 brake pads") is matched to the
  // catalog now — conservatively (matchPartsByName): an ambiguous name stays
  // unmatched and the item waits in Review.
  if (item.kind === 'parts_receipt' && !overrides.parts && !(item.payload?.parts || []).length) {
    const { matched } = matchPartsByName(item.payload?.partNames || [], data.parts);
    overrides = { ...overrides, parts: matched.map((m) => ({ partId: m.partId, qty: m.quantity, name: m.partName })) };
  }

  const missing = missingForApproval(item, overrides);
  if (missing) throw new Error(`Needs ${missing} — open Review in Omni`);
  const commit = COMMITTERS[item.kind];
  if (!commit) throw new Error(`Unsupported item type: ${item.kind}`);

  const p = { ...item.payload, ...overrides };
  const committedRef = await commit({ supa, orgId, item, p, by, data });

  // Teach the supplier → category (and ΑΦΜ → name) for next time.
  const learned = learnedRuleFromApproval(item, p);
  if (learned) {
    await createDoc(supa, 'bankRules', orgId, `${orgId}_learnedrule_${safe(learned.key)}`,
      { ...learned.rule, id: `learned-${safe(learned.key)}` }, by).catch(() => {});
  }

  await markDecided(supa, orgId, sdid, {
    status: 'approved', payload: p, committedRef: committedRef ?? null,
    decidedAt: iso(), decidedBy: by, decidedVia: via,
  });
  return committedRef;
}

export async function rejectOnServer(supa, orgId, sdid, { via = 'whatsapp', by = 'autopilot', reason = null } = {}) {
  const item = await freshItem(supa, orgId, sdid);
  if (!item) throw new Error('That item no longer exists');
  if (item.status !== 'pending') throw new Error(`Already ${String(item.status).replace('_', ' ')}`);
  await markDecided(supa, orgId, sdid, {
    status: 'rejected', rejectionReason: reason, decidedAt: iso(), decidedBy: by, decidedVia: via,
  });
}

