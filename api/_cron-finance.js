/**
 * api/cron-finance.js — the daily bookkeeping rules (AUTOMATION_PLAN §4.6):
 *
 *   - recurring-bill detection: a payee paid three months running with a steady
 *     amount becomes a suggested standing commitment
 *   - salary accrual: each owner's monthly salary (Owner ledger → monthly salary)
 *     becomes a "salary accrued" ledger item for the month
 *
 * Everything lands in /review as HELD items — a new commitment and anything in
 * the owner ledger are always confirmed by a person (owner policy 2026-09-22).
 * Idempotent: each suggestion has a stable id, so a daily run never duplicates
 * one, and a suggestion the owner rejected stays rejected (#702).
 *
 * Trigger: Vercel cron (after the bank + myDATA syncs) or an admin of this org.
 */
import { requireCronOrUser, requireOrgMember } from './_lib/require-auth.js';
import { supabaseAdmin } from './_lib/supabase-admin.js';
import { heartbeatOk, heartbeatFail } from './_lib/heartbeat.js';
import { ingestBatch, intakeOrgId, loadCosts, loadOwners } from './_lib/intake-store.js';
import { SUPABASE_TABLE } from '../src/lib/supabaseRowMap.js';
import { detectRecurringBills, salaryAccrualsDue } from '../src/utils/financeRules.js';

const HEARTBEAT_ENV = 'HEARTBEAT_FINANCE';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const auth = await requireCronOrUser(req, res);
  if (!auth) return;
  const orgId = intakeOrgId();
  if (!requireOrgMember(auth, orgId, res)) return;

  const now = new Date();
  try {
    const supa = supabaseAdmin();
    const [costs, owners, { data: cfgRow }] = await Promise.all([
      loadCosts(supa, orgId),
      loadOwners(supa, orgId),
      supa.from(SUPABASE_TABLE.config).select('data').eq('source_doc_id', `${orgId}_fleet`).maybeSingle(),
    ]);

    const recurring = detectRecurringBills(costs, { now });
    const salaries = salaryAccrualsDue(owners, cfgRow?.data?.ownerSalaries || {}, { now });

    const report = await ingestBatch([...recurring, ...salaries], { source: 'rule', orgId, now });

    await heartbeatOk(HEARTBEAT_ENV, `recurring=${recurring.length} salaries=${salaries.length} held=${report.held}`);
    return res.status(200).json({
      ok: true, recurringSuggested: recurring.length, salaryAccruals: salaries.length, ...report,
    });
  } catch (err) {
    const message = err?.message || String(err);
    console.error('[cron-finance]', message);
    await heartbeatFail(HEARTBEAT_ENV, message.slice(0, 200));
    return res.status(500).json({ ok: false, error: message });
  }
}
