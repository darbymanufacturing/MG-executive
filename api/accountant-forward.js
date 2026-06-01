/**
 * api/accountant-forward.js — Email a cost attachment to the accountant.
 *
 * POST /api/accountant-forward
 * Body (JSON):
 *   {
 *     costId:          string,
 *     vendor:          string,
 *     amount:          number,
 *     date:            "YYYY-MM-DD",
 *     attachmentUrl:   string,        // Firebase Storage public URL
 *     attachmentName:  string,        // filename, e.g. "invoice_2024_01.pdf"
 *     senderEmail:     string,        // logged-in user's email (for Reply-To); MUST match authUser.email
 *     senderName:      string,
 *   }
 *
 * NOTE: accountantEmail and fromEmail are NOT accepted from the request body.
 * Recipient is always process.env.ACCOUNTANT_EMAIL; sender is always
 * process.env.RESEND_FROM_EMAIL (or the hardcoded default). This prevents
 * authenticated staff from turning this endpoint into a spam relay.
 *
 * Returns:
 *   { success: true, messageId } | { error }
 *
 * Env vars required:
 *   RESEND_API_KEY         — Resend API key
 *   ACCOUNTANT_EMAIL       — recipient (the accountant's email)
 *   RESEND_FROM_EMAIL      — verified sender domain email, e.g. ops@yourcompany.com
 */

import { Resend } from 'resend';
import { requireUser } from './_lib/require-auth.js';

const resend = new Resend(process.env.RESEND_API_KEY);

// #17a — escape HTML to prevent XSS in email template
function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function buildEmailHtml({ vendor, amount, date, attachmentName, senderName }) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a202c;">
      <div style="background: #A0521D; padding: 24px 32px; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.01em;">
          Invoice forwarded for accounting
        </h1>
      </div>
      <div style="background: #fff; border: 1px solid #e2e8f0; border-top: none; padding: 28px 32px; border-radius: 0 0 8px 8px;">
        <p style="color: #4a5568; margin: 0 0 20px;">Hi,</p>
        <p style="color: #4a5568; margin: 0 0 20px;">
          ${escapeHtml(senderName)} has forwarded an invoice for processing:
        </p>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <tr style="background: #f7fafc;">
            <td style="padding: 10px 14px; font-weight: 600; color: #718096; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; width: 40%; border: 1px solid #e2e8f0;">Vendor</td>
            <td style="padding: 10px 14px; color: #1a202c; border: 1px solid #e2e8f0;">${escapeHtml(vendor) || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 10px 14px; font-weight: 600; color: #718096; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid #e2e8f0;">Amount</td>
            <td style="padding: 10px 14px; color: #1a202c; font-weight: 700; border: 1px solid #e2e8f0;">€${Number(amount || 0).toLocaleString('el-GR', { minimumFractionDigits: 2 })}</td>
          </tr>
          <tr style="background: #f7fafc;">
            <td style="padding: 10px 14px; font-weight: 600; color: #718096; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid #e2e8f0;">Date</td>
            <td style="padding: 10px 14px; color: #1a202c; border: 1px solid #e2e8f0;">${escapeHtml(date) || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 10px 14px; font-weight: 600; color: #718096; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid #e2e8f0;">File</td>
            <td style="padding: 10px 14px; color: #1a202c; border: 1px solid #e2e8f0;">${escapeHtml(attachmentName) || 'See attachment'}</td>
          </tr>
        </table>
        <p style="color: #718096; font-size: 13px; margin: 0;">
          Sent via Omni · Micromobility operations platform
        </p>
      </div>
    </div>
  `.trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // #16 — finance/email action: require a signed-in admin/staff user (was publicly callable).
  const authUser = await requireUser(req, res, { roles: ['admin', 'staff', 'owner'] });
  if (!authUser) return;

  const { RESEND_API_KEY } = process.env;
  if (!RESEND_API_KEY) {
    return res.status(500).json({ error: 'RESEND_API_KEY not configured' });
  }

  const {
    costId, vendor, amount, date,
    attachmentUrl, attachmentName,
    senderEmail, senderName = 'Omni Team',
  } = req.body || {};

  /* Recipient is always the configured env var — body override removed (#431) */
  const ACCOUNTANT_EMAIL = process.env.ACCOUNTANT_EMAIL;
  if (!ACCOUNTANT_EMAIL) {
    return res.status(500).json({ error: 'ACCOUNTANT_EMAIL not configured' });
  }

  /* Sender is always the configured env var — body override removed (#431) */
  const RESEND_FROM_EMAIL =
    process.env.RESEND_FROM_EMAIL ||
    'Omni <noreply@mgexecutive.app>';

  if (!attachmentUrl) {
    return res.status(400).json({ error: 'attachmentUrl is required' });
  }

  // #17 — SSRF whitelist: only allow Firebase Storage URLs
  const allowedHosts = ['firebasestorage.googleapis.com', 'storage.googleapis.com'];
  try {
    const parsedUrl = new URL(attachmentUrl);
    if (!allowedHosts.includes(parsedUrl.hostname)) {
      return res.status(400).json({ error: 'Attachment URL must be a Firebase Storage URL' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid attachment URL' });
  }

  try {
    /* Fetch the attachment file to embed it */
    let attachmentData = null;
    if (attachmentUrl) {
      try {
        // #374 — the allowlist only validates the INITIAL host, so do NOT follow 3xx to an
        // unvalidated (possibly internal) target. redirect:'manual' returns the 3xx unfollowed;
        // also cap the embedded body size to avoid an oversize-fetch memory DoS.
        // #434 — use a streaming reader so the abort fires BEFORE the body is fully buffered.
        const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
        const controller = new AbortController();
        const fileRes = await fetch(attachmentUrl, { redirect: 'manual', signal: controller.signal });
        if (fileRes.status >= 300 && fileRes.status < 400) {
          console.warn('Attachment URL returned a redirect; refusing to follow (SSRF guard).');
        } else if (fileRes.ok) {
          const declaredLen = Number(fileRes.headers.get('content-length') || 0);
          if (declaredLen > MAX_ATTACHMENT_BYTES) {
            console.warn('Attachment exceeds 10 MB (content-length); skipping embed.');
          } else {
            // Stream body incrementally — abort as soon as we exceed the size limit
            // so we never buffer more than MAX_ATTACHMENT_BYTES (#434).
            const reader = fileRes.body.getReader();
            const chunks = [];
            let totalBytes = 0;
            let aborted = false;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              totalBytes += value.byteLength;
              if (totalBytes > MAX_ATTACHMENT_BYTES) {
                controller.abort();
                aborted = true;
                break;
              }
              chunks.push(value);
            }
            if (!aborted) {
              const combined = new Uint8Array(totalBytes);
              let offset = 0;
              for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
              attachmentData = Buffer.from(combined).toString('base64');
            } else {
              console.warn('Attachment exceeds 10 MB (streaming); skipping embed.');
            }
          }
        }
      } catch (fetchErr) {
        console.warn('Could not fetch attachment for embedding:', fetchErr.message);
      }
    }

    /* Reply-To is only set when senderEmail matches the authenticated user's
       own email — prevents impersonation via arbitrary reply-to (#431) */
    const safeReplyTo = (senderEmail && senderEmail === authUser.email) ? senderEmail : null;

    const emailPayload = {
      from: RESEND_FROM_EMAIL || 'Omni <noreply@mgexecutive.app>',
      to: [ACCOUNTANT_EMAIL],
      ...(safeReplyTo ? { replyTo: safeReplyTo } : {}),
      subject: `Invoice: ${vendor || 'Unknown vendor'} — €${Number(amount || 0).toFixed(2)} (${date || 'no date'})`,
      html: buildEmailHtml({ vendor, amount, date, attachmentName, senderName }),
    };

    /* Attach file if we fetched it successfully */
    if (attachmentData && attachmentName) {
      emailPayload.attachments = [
        {
          filename: attachmentName,
          content: attachmentData,
        },
      ];
    }

    const result = await resend.emails.send(emailPayload);

    if (result.error) {
      console.error('Resend error:', result.error);
      return res.status(500).json({ error: result.error.message || 'Email send failed' });
    }

    return res.status(200).json({
      success: true,
      messageId: result.data?.id,
      costId,
      forwardedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('accountant-forward error:', err);
    return res.status(500).json({ error: err.message || 'Forward failed' });
  }
}
