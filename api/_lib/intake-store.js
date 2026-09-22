/**
 * api/_lib/intake-store.js — server-side persistence for Omni Autopilot intake
 * (docs/AUTOMATION_PLAN.md §3). Shared by every ingest endpoint:
 * _intake-wallet.js, _intake-mydata.js, _intake-email.js (and Phase 2's
 * WhatsApp webhook).
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
import { SUPABASE_TABLE } from '../../src/lib/supabaseRowMap.js';
import { prepareIntakeItem, payeeKey } from '../../src/utils/intake.js';

export const INTAKE_TABLE = 'intake_items';

/** Org this deployment writes for (same env var the MCP connector uses). */
export const intakeOrgId = () => process.env.MCP_ORG_ID || 'mg-executive-org';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

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
 * Suppliers Omni has already been taught (by an earlier approval, or simply by
 * an existing categorized cost). Feeds classifyIntake's "known supplier" rule.
 */
export function knownSuppliersFrom(costs) {
  const set = new Set();
  for (const c of costs) {
    if (!c?.name) continue;
    if (!c.category || c.category === 'Unknown') continue;
    set.add(payeeKey(c.name));
  }
  return set;
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

/** Has this source record already been seen? (cheap pre-filter before work) */
export async function existingIntakeRefs(supa, orgId, source) {
  const { data, error } = await supa
    .from(INTAKE_TABLE)
    .select('source_doc_id')
    .eq('org_id', orgId)
    .like('source_doc_id', `${orgId}_intake_${source}_%`);
  if (error) return new Set();
  return new Set((data || []).map((r) => r.source_doc_id));
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
  return { costId: id, sourceDocId: sdid };
}

/**
 * Mark the month of an existing cost as PAID because its bank debit arrived
 * (ADR-0027 settlements map). This is what replaces the owner's manual ticking.
 */
export async function commitSettlement(supa, orgId, targetCostId, dateISO) {
  const { data: rows, error: readErr } = await supa
    .from(SUPABASE_TABLE.costs)
    .select('source_doc_id, data')
    .eq('org_id', orgId);
  if (readErr) throw new Error(`settlement read failed: ${readErr.message}`);

  const row = (rows || []).find((r) => r.data?.id === targetCostId);
  if (!row) return { settled: false, reason: 'target cost not found' };

  const period = String(dateISO || '').slice(0, 7); // YYYY-MM
  if (!/^\d{4}-\d{2}$/.test(period)) return { settled: false, reason: 'bad period' };

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
 * waiting for the owner, how many were duplicates.
 */
export async function ingestBatch(rawItems, { source, orgId = intakeOrgId(), now = new Date() } = {}) {
  const supa = supabaseAdmin();
  const [costs, automation] = await Promise.all([
    loadCosts(supa, orgId),
    loadAutomationConfig(supa, orgId),
  ]);
  const ctx = {
    now,
    knownSuppliers: knownSuppliersFrom(costs),
    trustWalletCategories: automation.trustWalletCategories !== false,
  };

  const report = { source, seen: rawItems.length, auto: 0, held: 0, merged: 0, settled: 0, errors: [] };

  for (const raw of rawItems) {
    try {
      const item = prepareIntakeItem({ ...raw, source }, costs, ctx);
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
          const res = await commitSettlement(supa, orgId, item.match.targetId, item.payload.date);
          item.committedRef = item.match.targetId;
          if (res.settled) report.settled += 1; else report.merged += 1;
        } else {
          const { costId } = await commitCost(supa, orgId, item);
          item.committedRef = costId;
          // Keep the matcher honest for the rest of this batch.
          costs.push({ id: costId, name: item.payload.name, amount: item.payload.amount, startDate: item.payload.date, frequency: 'one-time', _intakeRef: `${item.source}:${item.sourceRef}` });
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
