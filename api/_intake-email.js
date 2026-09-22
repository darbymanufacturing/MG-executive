/**
 * api/intake-email.js — receive invoice emails from the Gmail watcher and file
 * them into the Autopilot intake queue (docs/AUTOMATION_PLAN.md §4.3).
 *
 * The owner's suppliers already email PDFs to the company inboxes, so the design
 * deliberately avoids asking anyone to change habits: a Gmail filter labels
 * those messages, and a free Google Apps Script (scripts/gmail-intake.gs) posts
 * each new attachment here every 15 minutes. Nothing to forward by hand.
 *
 * AUTH: a shared secret, not a user session — the caller is a script, exactly
 * like the MCP connector's `tokenOk()` precedent. Constant-time compare, and
 * 503 (not 401) when the secret isn't configured, so a half-finished setup can
 * never be silently open.
 *
 * Env:
 *   INTAKE_EMAIL_SECRET      shared secret; also pasted into the Apps Script
 *   INTAKE_EMAIL_ALLOWLIST   optional comma-separated sender substrings. From
 *                            headers are spoofable, so this is a routing signal
 *                            only: non-matching senders are still accepted but
 *                            forced to "hold for review" rather than trusted.
 *   ANTHROPIC_KEY            for extraction
 */
import { timingSafeEqual } from 'node:crypto';
import { ingestBatch, intakeOrgId } from './_lib/intake-store.js';
import { storeReceipt } from './_lib/receipt-store.js';
import { extractInvoice, extractionToIntake } from './_lib/invoice-extract.js';
import { heartbeatOk, heartbeatFail } from './_lib/heartbeat.js';

const HEARTBEAT_ENV = 'HEARTBEAT_INTAKE_EMAIL';
const MAX_ATTACHMENTS = 10;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB, same cap as accountant-forward
const ALLOWED_TYPES = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
]);

function secretOk(req) {
  const expected = process.env.INTAKE_EMAIL_SECRET;
  if (!expected) return { configured: false, ok: false };

  const header = req.headers?.['x-intake-secret']
    || String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(String(header || ''));
  const b = Buffer.from(expected);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  return { configured: true, ok };
}

const senderTrusted = (from) => {
  const list = (process.env.INTAKE_EMAIL_ALLOWLIST || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return false;
  const f = String(from || '').toLowerCase();
  return list.some((entry) => f.includes(entry));
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { configured, ok } = secretOk(req);
  if (!configured) {
    return res.status(503).json({
      ok: false,
      error: 'Email intake is not configured. Set INTAKE_EMAIL_SECRET in Vercel and paste the same value into scripts/gmail-intake.gs.',
    });
  }
  if (!ok) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  const { messageId, from, subject, receivedAt, attachments } = req.body || {};
  if (!messageId || !Array.isArray(attachments) || attachments.length === 0) {
    return res.status(400).json({ ok: false, error: 'messageId and at least one attachment are required' });
  }

  const trusted = senderTrusted(from);
  const raws = [];
  const skipped = [];

  for (const att of attachments.slice(0, MAX_ATTACHMENTS)) {
    const { filename, mimeType, contentBase64 } = att || {};
    if (!contentBase64 || !ALLOWED_TYPES.has(mimeType)) {
      skipped.push({ filename, reason: `unsupported type ${mimeType || 'unknown'}` });
      continue;
    }
    // base64 inflates by ~4/3; check the decoded size.
    if ((contentBase64.length * 3) / 4 > MAX_BYTES) {
      skipped.push({ filename, reason: 'larger than 10 MB' });
      continue;
    }

    try {
      const [extracted, fileUrl] = await Promise.all([
        extractInvoice({ base64: contentBase64, mimeType, hint: subject }),
        // Keep the original PDF/photo for VAT audits and the accountant pack.
        storeReceipt({ base64: contentBase64, mimeType }, { orgId: intakeOrgId(), ref: `${messageId}_${filename || 'attachment'}` }),
      ]);
      const raw = extractionToIntake(extracted, {
        sourceRef: `${messageId}:${filename || 'attachment'}`,
        evidence: { from, subject, filename, receivedAt, senderTrusted: trusted, fileUrl },
      });
      // An untrusted sender never gets the benefit of the doubt: force review by
      // dropping the category guess, which sends it down the "hold" path.
      if (!trusted) raw.payload.category = null;
      raws.push(raw);
    } catch (err) {
      skipped.push({ filename, reason: err?.message || String(err) });
    }
  }

  if (!raws.length) {
    await heartbeatFail(HEARTBEAT_ENV, `nothing extracted from ${messageId}`);
    return res.status(200).json({ ok: true, extracted: 0, skipped });
  }

  try {
    const report = await ingestBatch(raws, { source: 'gmail' });
    await heartbeatOk(HEARTBEAT_ENV, `docs=${raws.length} auto=${report.auto} held=${report.held}`);
    return res.status(200).json({ ok: true, extracted: raws.length, skipped, ...report });
  } catch (err) {
    const message = err?.message || String(err);
    console.error('[intake-email]', message);
    await heartbeatFail(HEARTBEAT_ENV, message.slice(0, 200));
    return res.status(502).json({ ok: false, error: message });
  }
}
