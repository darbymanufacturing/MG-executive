/**
 * api/_lib/intake-store.js — server-side persistence for Omni Autopilot intake
 * (docs/AUTOMATION_PLAN.md §3). Shared by every ingest endpoint:
 * _intake-wallet.js, _intake-mydata.js, _intake-email.js, _whatsapp.js.
 *
 * WHY SERVICE-ROLE, NOT orgWrite: these callers are robots. There is no
 * Firebase-authenticated user behind a cron tick or a webhook, so the
 * client-side `orgWrite`/`useOrgCollection` seam cannot be used. This mirrors
 * the one existing precedent in the codebase — `api/_mcp.js`'s `add_cost` —
 * including its composite `source_doc_id` convention, so writes stay idempotent
 * and org-scoped.
 *
 * The decision rules themselves live in `src/utils/intake.js` (pure, tested,
 * and imported by the Review UI too) — this file only reads, writes and commits.
 */
import { supabaseAdmin } from './supabase-admin.js';
import { SUPABASE_TABLE, toSupabaseRow } from '../../src/lib/supabaseRowMap.js';
import { prepareIntakeItem } from '../../src/utils/intake.js';
import { loanForDebit, loanPaymentRaw } from '../../src/utils/intakeRecords.js';

export const INTAKE_TABLE = 'intake_items';

/** Org this deployment writes for (same env var the MCP connector uses). */
export const intakeOrgId = () => process.env.MCP_ORG_ID || 'mg-executive-org';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const MAX_BACKFILL_DAYS = 800; // ~2 years; the feeds keep more, Omni doesn't need it

/**
 * ?from=YYYY-MM-DD on a MANUAL run → the back-fill start date (clamped to ~2
 * years), else null. Crons never back-fill: a scheduled run reads its normal
 * window, so a bad query string can't turn every tick into a full re-import.
 */
export function backfillFrom(query, auth, now = new Date()) {
  const from = String(query?.from || '');
  if (auth?.trigger !== 'manual' || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return null;
  const today = now.toISOString().slice(0, 10);
  if (from > today) return null;
  const earliest = new Date(now.getTime() - MAX_BACKFILL_DAYS * 86_400_000).toISOString().slice(0, 10);
  return from < earliest ? earliest : from;
}

/** Deterministic, collision-free id for an intake item (orgDocId convention). */
export function intakeDocId(orgId, source, sourceRef) {
  const safeRef = String(sourceRef || '')
    .replace(/[^A-Za-z0-9_.-]/g, '_')
    .slice(0, 100) || 'noref';
  return `${orgId}_intake_${source}_${safeRef}`;
}

/** All cost rows for the org, as the plain docs the matcher expects. */
export async function loadCosts(supa, orgId) {
  const { data, error } = await supa
    .from(SUPABASE_TABLE.costs)
    .select('data')
    .eq('org_id', orgId);
  if (error) throw new Error(`load costs failed: ${error.message}`);
  return (data || []).map((r) => r.data).filter(Boolean);
}

/**
 * The org's categorization rules — the owner's own keyword rules AND the ones
 * approvals taught (`learned: true`), both in the FF-2 `bank_rules` table so the
 * owner can see and edit every one on Bank Import → Rules. Never throws: no
 * rules just means more items wait for review.
 */
export async function loadRules(supa, orgId) {
  try {
    const { data, error } = await supa
      .from(SUPABASE_TABLE.bankRules)
      .select('data')
      .eq('org_id', orgId);
    if (error) return [];
    return (data || []).map((r) => r.data).filter(Boolean);
  } catch {
    return [];
  }
}

/** The org's loans (FF-2), for recognising installment debits. Never throws. */
export async function loadLoans(supa, orgId) {
  try {
    const { data, error } = await supa.from(SUPABASE_TABLE.loans).select('source_doc_id, data').eq('org_id', orgId);
    if (error) return [];
    return (data || []).map((r) => ({ ...(r.data || {}), _docId: r.source_doc_id }));
  } catch {
    return [];
  }
}

/** The org's owners (people the owner ledger can owe). Never throws. */
export async function loadOwners(supa, orgId) {
  try {
    const { data, error } = await supa.from(SUPABASE_TABLE.users).select('source_doc_id, data').eq('org_id', orgId);
    if (error) return [];
    return (data || [])
      .map((r) => ({ ...(r.data || {}), _docId: r.source_doc_id }))
      .filter((u) => u.isOwner || u.role === 'owner');
  } catch {
    return [];
  }
}

/** Read the org's automation config (owner switches). Never throws. */
export async function loadAutomationConfig(supa, orgId) {
  try {
    const { data } = await supa
      .from(SUPABASE_TABLE.config)
      .select('data')
      .eq('source_doc_id', `${orgId}_fleet`)
      .maybeSingle();
    return data?.data?.automation || {};
  } catch {
    return {};
  }
}

/** Read Autopilot's status document (see saveAutopilotState). Never throws. */
export async function loadAutopilotState(orgId) {
  try {
    const { data } = await supabaseAdmin()
      .from(SUPABASE_TABLE.config)
      .select('data')
      .eq('source_doc_id', `${orgId}_autopilot`)
      .maybeSingle();
    return data?.data || {};
  } catch {
    return {};
  }
}

/**
 * Autopilot's own status document (app_config `${orgId}_autopilot`): last sync
 * per feed, the Wallet cash position, and similar robot-produced state.
 *
 * Deliberately NOT the owner-edited fleet config: only robots write this row, so
 * a sync can never overwrite a setting the owner changed a second earlier.
 * Top-level keys are replaced; `lastSync` is merged per feed. Never throws — a
 * status write must not fail the sync it reports on.
 */
export async function saveAutopilotState(orgId, patch) {
  try {
    const supa = supabaseAdmin();
    const sdid = `${orgId}_autopilot`;
    const { data } = await supa
      .from(SUPABASE_TABLE.config)
      .select('data')
      .eq('source_doc_id', sdid)
      .maybeSingle();
    const prev = data?.data || {};
    const next = {
      ...prev,
      ...patch,
      lastSync: { ...(prev.lastSync || {}), ...(patch.lastSync || {}) },
      updatedAt: new Date().toISOString(),
    };
    const { error } = await supa
      .from(SUPABASE_TABLE.config)
      .upsert(toSupabaseRow('config', orgId, sdid, next), { onConflict: 'source_doc_id' });
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    console.warn('[autopilot-state] not saved:', err?.message || err);
    return false;
  }
}

/**
 * Upsert one prepared intake item.
 * Idempotent on (org_id, source_doc_id): re-running a sync is a no-op.
 */
export async function upsertIntakeItem(supa, orgId, item) {
  const sdid = intakeDocId(orgId, item.source, item.sourceRef);
  const { error } = await supa
    .from(INTAKE_TABLE)
    .upsert({ org_id: orgId, source_doc_id: sdid, data: item }, { onConflict: 'source_doc_id' });
  if (error) throw new Error(`intake upsert failed: ${error.message}`);
  return sdid;
}

/**
 * The intake items already stored for one source, by source_doc_id.
 * #702: every sync re-reads a 45-day window, so without this an item the owner
 * REJECTED was re-prepared as `pending` and upserted over the rejection — it
 * came back every day for six weeks. Never throws (a missing table reads empty).
 */
export async function existingIntakeItems(supa, orgId, source) {
  try {
    const { data, error } = await supa
      .from(INTAKE_TABLE)
      .select('source_doc_id, data')
      .eq('org_id', orgId)
      .like('source_doc_id', `${orgId}_intake_${source}_%`);
    if (error) return new Map();
    return new Map((data || []).map((r) => [r.source_doc_id, r.data || {}]));
  } catch {
    return new Map();
  }
}

/* ── commit paths ─────────────────────────────────────────────────────────── */

/** Write a new cost row from an intake item (service-role, add_cost shape). */
export async function commitCost(supa, orgId, item) {
  const id = globalThis.crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const p = item.payload || {};
  const data = {
    id,
    name: p.name,
    amount: round2(p.amount),
    category: p.category || 'Unknown',
    frequency: 'one-time',
    startDate: p.date,
    notes: p.notes || null,
    vatIncluded: p.vatAmount != null ? true : undefined,
    vatAmount: p.vatAmount != null ? round2(p.vatAmount) : undefined,
    supplierVat: p.counterpartVat || undefined,
    mydataMark: item.evidence?.mydataMark || undefined,
    projectId: p.projectId || undefined,
    source: `autopilot-${item.source}`,
    _intakeRef: `${item.source}:${item.sourceRef}`,
    receiptUrl: item.evidence?.fileUrl || undefined,
    createdByUid: 'autopilot',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const sdid = `${orgId}_autopilot_${item.source}_${String(item.sourceRef).slice(0, 60)}`;
  const { error } = await supa
    .from(SUPABASE_TABLE.costs)
    .upsert({ id, org_id: orgId, source_doc_id: sdid, data }, { onConflict: 'source_doc_id' });
  if (error) throw new Error(`cost insert failed: ${error.message}`);
  return { costId: id, sourceDocId: sdid, cost: data };
}

/**
 * Mark one occurrence of an existing cost as PAID because its bank debit
 * arrived (ADR-0027 settlements map). `period` is the OCCURRENCE month chosen by
 * the matcher (settlementPeriodFor) — not the debit's month (#705).
 */
export async function commitSettlement(supa, orgId, targetCostId, period) {
  if (!/^\d{4}-\d{2}$/.test(String(period || ''))) return { settled: false, reason: 'bad period' };

  const { data: rows, error: readErr } = await supa
    .from(SUPABASE_TABLE.costs)
    .select('source_doc_id, data')
    .eq('org_id', orgId);
  if (readErr) throw new Error(`settlement read failed: ${readErr.message}`);

  const row = (rows || []).find((r) => r.data?.id === targetCostId);
  if (!row) return { settled: false, reason: 'target cost not found' };

  const settlements = { ...(row.data.settlements || {}) };
  if (settlements[period]?.status === 'paid') return { settled: false, reason: 'already paid' };
  settlements[period] = { status: 'paid', at: new Date().toISOString(), by: 'autopilot' };

  const { error } = await supa
    .from(SUPABASE_TABLE.costs)
    .update({ data: { ...row.data, settlements, updatedAt: new Date().toISOString() } })
    .eq('source_doc_id', row.source_doc_id);
  if (error) throw new Error(`settlement write failed: ${error.message}`);
  return { settled: true, period };
}

/**
 * Ingest a batch of raw records from one source.
 *
 * Returns a report the caller can hand straight back to the cron/webhook and to
 * the heartbeat body: how many were committed automatically, how many are
 * waiting for the owner, how many were duplicates, how many were already decided.
 */
export async function ingestBatch(rawItems, { source, orgId = intakeOrgId(), now = new Date() } = {}) {
  const supa = supabaseAdmin();
  const [costs, automation, rules, existing, loans] = await Promise.all([
    loadCosts(supa, orgId),
    loadAutomationConfig(supa, orgId),
    loadRules(supa, orgId),
    existingIntakeItems(supa, orgId, source),
    source === 'wallet' ? loadLoans(supa, orgId) : Promise.resolve([]),
  ]);
  const baseCtx = {
    now,
    rules,
    trustWalletCategories: automation.trustWalletCategories !== false,
  };

  const report = {
    source, seen: rawItems.length, auto: 0, held: 0, merged: 0, settled: 0, alreadyDecided: 0, errors: [],
  };

  for (const raw of rawItems) {
    try {
      const sdid = intakeDocId(orgId, source, raw.sourceRef);
      const prior = existing.get(sdid);
      // #702 — a decision is final. Only still-pending items are re-evaluated
      // (a bill added since may now match), and an item the owner UNDID keeps
      // waiting for them instead of re-committing itself.
      if (prior && prior.status && prior.status !== 'pending') {
        report.alreadyDecided += 1;
        continue;
      }

      // A bank debit that pays a loan installment is a loan payment (always held):
      // interest is a cost, principal only lowers the balance (FF-2 gotcha #3).
      const loan = source === 'wallet' && raw.kind === 'cost' ? loanForDebit(loans, raw.payload) : null;
      const shaped = loan ? loanPaymentRaw(raw, loan) : raw;

      const item = prepareIntakeItem({ ...shaped, source, createdAt: prior?.createdAt }, costs, {
        ...baseCtx, noAuto: Boolean(prior?.noAuto),
      });
      if (!item.sourceRef) {
        report.errors.push('item without sourceRef skipped');
        continue;
      }

      if (item.status === 'auto_committed') {
        if (item.match?.type === 'duplicate') {
          item.status = 'merged';
          item.committedRef = item.match.targetId;
          report.merged += 1;
        } else if (item.match?.type === 'commitment' || item.match?.type === 'invoice_payment') {
          const res = await commitSettlement(supa, orgId, item.match.targetId, item.match.period);
          item.committedRef = item.match.targetId;
          item.settledPeriod = res.settled ? res.period : null;
          if (res.settled) report.settled += 1; else { item.status = 'merged'; report.merged += 1; }
        } else {
          const { costId, cost } = await commitCost(supa, orgId, item);
          item.committedRef = costId;
          // Keep the matcher honest for the rest of this batch.
          costs.push(cost);
          report.auto += 1;
        }
        item.decidedAt = new Date().toISOString();
        item.decidedBy = 'autopilot';
      } else {
        report.held += 1;
      }

      await upsertIntakeItem(supa, orgId, item);
    } catch (err) {
      report.errors.push(err?.message || String(err));
    }
  }

  return report;
}
