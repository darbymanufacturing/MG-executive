/**
 * api/accountant-pack.js — send the month's expenses to the accountant as one
 * CSV (with receipt links). Autopilot Phase 4, closes #700.
 *
 * #700: the old "forward to accountant" feature had no button and kept the
 * accountant's address in one browser's localStorage while the server read an
 * env var. Now the address lives in org config (Settings → Integrations) and
 * this endpoint does the whole month at once.
 *
 * Owner policy "hold until approved": nothing is emailed without a person
 * pressing Send. POST { month, send: false } returns a PREVIEW (count, totals,
 * recipient); only { send: true } emails it.
 *
 * Auth: signed-in admin / owner / staff (finance action, same gate as
 * accountant-forward).
 */
import { Resend } from 'resend';
import { requireUser } from './_lib/require-auth.js';
import { supabaseAdmin } from './_lib/supabase-admin.js';
import { loadAutopilotState, saveAutopilotState } from './_lib/intake-store.js';
import { SUPABASE_TABLE } from '../src/lib/supabaseRowMap.js';
import { monthExpenses, packTotals, packCsv } from '../src/utils/accountantPack.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const escapeHtml = (str) => String(str ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const eur = (n) => `€${Number(n || 0).toFixed(2)}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireUser(req, res, { roles: ['admin', 'staff', 'owner'] });
  if (!user) return;

  const { month, send = false } = req.body || {};
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) {
    return res.status(400).json({ error: 'month must be YYYY-MM' });
  }

  // Multi-tenant: always the CALLER's org (their orgId claim), never a configured
  // default — otherwise any tenant's admin could preview another org's expenses
  // and CC themselves on its CSV.
  const orgId = user.orgId;
  if (!orgId) {
    return res.status(403).json({ error: 'No organization on this session — sign out and back in, then try again.' });
  }
  try {
    const supa = supabaseAdmin();
    const [{ data: costRows, error: costErr }, { data: cfg }] = await Promise.all([
      supa.from(SUPABASE_TABLE.costs).select('data').eq('org_id', orgId),
      supa.from(SUPABASE_TABLE.config).select('data').eq('source_doc_id', `${orgId}_fleet`).maybeSingle(),
    ]);
    if (costErr) throw new Error(`costs: ${costErr.message}`);

    const rows = monthExpenses((costRows || []).map((r) => r.data), month);
    const totals = packTotals(rows);
    const recipient = cfg?.data?.accountantEmail || process.env.ACCOUNTANT_EMAIL || null;

    if (!send) {
      return res.status(200).json({ ok: true, preview: true, month, recipient, ...totals });
    }

    if (!recipient || !EMAIL_RE.test(recipient)) {
      return res.status(400).json({ error: 'Set the accountant email in Settings → Integrations first.' });
    }
    if (!rows.length) {
      return res.status(400).json({ error: `No expenses recorded for ${month} — nothing to send.` });
    }
    if (!process.env.RESEND_API_KEY) {
      return res.status(503).json({ error: 'Email is not configured (RESEND_API_KEY missing).' });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.RESEND_FROM_EMAIL || 'Omni <onboarding@resend.dev>';
    const csv = packCsv(rows);

    const { error: sendErr } = await resend.emails.send({
      from,
      to: [recipient],
      ...(user.email ? { cc: [user.email], reply_to: user.email } : {}),
      subject: `Omni — expenses for ${month} (${totals.count} items, ${eur(totals.total)})`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; color: #0F172A;">
          <h2 style="color: #A0521D; margin: 0 0 12px;">Expenses for ${escapeHtml(month)}</h2>
          <p>Attached is this month's expense list from Omni.</p>
          <table style="border-collapse: collapse; font-size: 14px;">
            <tr><td style="padding: 4px 16px 4px 0;">Items</td><td><strong>${totals.count}</strong></td></tr>
            <tr><td style="padding: 4px 16px 4px 0;">Total (gross)</td><td><strong>${escapeHtml(eur(totals.total))}</strong></td></tr>
            <tr><td style="padding: 4px 16px 4px 0;">VAT recorded</td><td><strong>${escapeHtml(eur(totals.vat))}</strong></td></tr>
            <tr><td style="padding: 4px 16px 4px 0;">With receipt link</td><td><strong>${totals.withReceipt}</strong></td></tr>
          </table>
          <p style="color: #64748B; font-size: 12px; margin-top: 16px;">
            The CSV opens in Excel (semicolon-separated, comma decimals). Receipt links point to the original documents.
          </p>
        </div>`,
      attachments: [{
        filename: `omni-expenses-${month}.csv`,
        content: Buffer.from(csv, 'utf8').toString('base64'),
      }],
    });
    if (sendErr) throw new Error(sendErr.message || 'Resend rejected the email');

    // Remember it went out: the panel shows "sent on …" and the morning brief
    // stops nudging about this month's pack.
    const state = await loadAutopilotState(orgId);
    const sentAt = new Date().toISOString();
    await saveAutopilotState(orgId, {
      accountantPacks: {
        ...(state.accountantPacks || {}),
        [month]: { sentAt, to: recipient, by: user.email || user.uid, count: totals.count, total: totals.total },
      },
    });

    return res.status(200).json({ ok: true, sent: true, sentAt, month, recipient, ...totals });
  } catch (err) {
    console.error('[accountant-pack]', err?.message || err);
    return res.status(500).json({ error: 'Could not build or send the pack.' });
  }
}
