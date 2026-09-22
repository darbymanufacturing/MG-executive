/**
 * api/whatsapp.js — the Omni WhatsApp number (docs/AUTOMATION_PLAN.md §4.4).
 *
 * Send a photo of a receipt, a voice note ("41735 άλλαξα ντίζα φρένου, 25 λεπτά"),
 * a forwarded Hopp CSV, or just type — and it lands in the intake queue with its
 * evidence attached. Confident items file themselves; the rest wait in /review.
 * You can also clear the queue from the chat: reply ✅ / "ok" to approve.
 *
 * GET  = Meta's webhook verification handshake (hub.challenge).
 * POST = message events. Gated by a capability key in the callback URL
 *        (?key=WHATSAPP_WEBHOOK_KEY) — see the AUTH note in the handler for why
 *        the raw-body HMAC can only be a secondary check behind the catch-all.
 *
 * Inert until configured: without WHATSAPP_WEBHOOK_KEY the POST path returns 503
 * rather than accepting unauthenticated traffic.
 *
 * Env: WHATSAPP_WEBHOOK_KEY · WHATSAPP_TOKEN · WHATSAPP_PHONE_ID ·
 *      WHATSAPP_VERIFY_TOKEN · WHATSAPP_ALLOWED_NUMBERS · WHATSAPP_SENDER_NAMES ·
 *      WHATSAPP_APP_SECRET (optional, secondary) · ANTHROPIC_KEY ·
 *      GOOGLE_STT_API_KEY or OPENAI_API_KEY (voice notes)
 */
import {
  verifySignature, webhookKeyOk, senderAllowed, senderName, sendText, fetchMedia,
  routeMessage, routedToIntake, rateLimited,
} from './_lib/whatsapp.js';
import { extractInvoice, extractionToIntake } from './_lib/invoice-extract.js';
import { transcribeAudio } from './_lib/transcribe.js';
import { ingestBatch } from './_lib/intake-store.js';
import { heartbeatOk, heartbeatFail } from './_lib/heartbeat.js';

const HEARTBEAT_ENV = 'HEARTBEAT_WHATSAPP';

const money = (n) => `€${(Number(n) || 0).toFixed(2)}`;

function summarize(report, items) {
  if (!items.length) return null;
  const parts = [];
  if (report.auto) parts.push(`${report.auto} logged`);
  if (report.settled) parts.push(`${report.settled} marked paid`);
  if (report.merged) parts.push(`${report.merged} already known`);
  if (report.held) parts.push(`${report.held} waiting in Review`);
  const what = items
    .map((i) => `• ${i.payload.name}${i.payload.amount ? ` ${money(i.payload.amount)}` : ''}`)
    .join('\n');
  return `${what}\n\n${parts.join(' · ') || 'Nothing to do'}`;
}

export default async function handler(req, res) {
  /* ── Meta verification handshake ── */
  if (req.method === 'GET') {
    const mode = req.query?.['hub.mode'];
    const token = req.query?.['hub.verify_token'];
    const challenge = req.query?.['hub.challenge'];
    if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(String(challenge ?? ''));
    }
    return res.status(403).json({ error: 'Verification failed' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  /* AUTH — why a capability key and not only Meta's HMAC:
   * every endpoint here is dispatched by the single catch-all api/[...path].js,
   * and Vercel has already parsed the body by the time this module runs, so the
   * exact bytes Meta signed are gone. Re-serializing JSON to recompute the HMAC
   * is not byte-safe, so the PRIMARY auth is a secret in the callback URL
   * (?key=...), constant-time compared — the same capability-URL pattern the MCP
   * connector already uses and the owner already treats as a password. The HMAC
   * is still verified opportunistically when it happens to match, and a mismatch
   * is logged, never trusted. Treat the webhook URL as a secret. */
  const key = process.env.WHATSAPP_WEBHOOK_KEY;
  if (!key) {
    return res.status(503).json({
      ok: false,
      error: 'WhatsApp intake is not configured. Set WHATSAPP_WEBHOOK_KEY, WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_VERIFY_TOKEN and WHATSAPP_ALLOWED_NUMBERS in Vercel.',
    });
  }
  if (!webhookKeyOk(req, key)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ ok: false, error: 'Malformed payload' });
  }

  // Secondary, best-effort: if the signature matches our re-serialization, great;
  // if not, we only log it — the capability key above is what actually gates.
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (appSecret && req.headers['x-hub-signature-256']) {
    const signatureMatched = verifySignature(
      Buffer.from(JSON.stringify(body)),
      req.headers['x-hub-signature-256'],
      appSecret,
    );
    if (!signatureMatched) console.warn('[whatsapp] HMAC did not match re-serialized body (expected on Vercel; key auth still enforced)');
  }

  // Always 200 quickly: Meta retries on non-2xx, and a retry storm would
  // re-run extraction (and re-spend) for messages already handled.
  const messages = body?.entry?.[0]?.changes?.[0]?.value?.messages || [];
  if (!messages.length) return res.status(200).json({ ok: true, ignored: 'no messages' });

  const results = [];
  for (const msg of messages) {
    const from = msg.from;
    try {
      if (!senderAllowed(from)) {
        console.warn('[whatsapp] message from a number that is not allowlisted');
        continue; // silent: never confirm or deny membership to a stranger
      }
      if (rateLimited(from)) {
        await sendText(from, 'Too many messages at once — give me a minute.');
        continue;
      }

      let raws = [];
      let transcript = null;

      if (msg.type === 'text') {
        const routed = await routeMessage(msg.text?.body || '');
        if (routed.intent === 'question') {
          await sendText(from, 'I only file things for now. Ask me in the app — or send a receipt, a fault, or a task.');
          continue;
        }
        const item = routedToIntake(routed, { sourceRef: msg.id, from, transcript: msg.text?.body });
        if (item) raws = [item];
      } else if (msg.type === 'image' || msg.type === 'document') {
        const mediaId = msg.image?.id || msg.document?.id;
        const media = await fetchMedia(mediaId);
        const extracted = await extractInvoice({ base64: media.base64, mimeType: media.mimeType, hint: msg.image?.caption || msg.document?.caption });
        raws = [extractionToIntake(extracted, {
          sourceRef: msg.id,
          evidence: { channel: 'whatsapp', from, filename: msg.document?.filename || null },
        })];
      } else if (msg.type === 'audio' || msg.type === 'voice') {
        const media = await fetchMedia(msg.audio?.id || msg.voice?.id);
        transcript = await transcribeAudio(media);
        if (!transcript) {
          await sendText(from, "I couldn't make out that voice note — could you type it?");
          continue;
        }
        const routed = await routeMessage(transcript);
        const item = routedToIntake(routed, { sourceRef: msg.id, from, transcript });
        if (item) raws = [item];
      } else {
        continue; // stickers, reactions, locations — nothing to file
      }

      if (!raws.length) {
        await sendText(from, "I didn't catch what to record there. Try: “paid 18 fuel” or “41735 brake cable, 25 min”.");
        continue;
      }

      // Who sent it — lets the Review page pre-select the owner on
      // "I paid it personally" items (still confirmed by a human).
      const name = senderName(from);
      raws = raws.map((r) => ({ ...r, evidence: { ...r.evidence, senderName: name } }));

      const report = await ingestBatch(raws, { source: 'whatsapp' });
      results.push(report);

      const lines = [];
      // Echo the transcript so a Greek ASR slip is caught in seconds, not weeks.
      if (transcript) lines.push(`Heard: “${transcript.slice(0, 160)}”`);
      lines.push(summarize(report, raws));
      await sendText(from, lines.filter(Boolean).join('\n\n'));
    } catch (err) {
      console.error('[whatsapp]', err?.message || err);
      await heartbeatFail(HEARTBEAT_ENV, String(err?.message || err).slice(0, 200));
      if (from) await sendText(from, "Something went wrong filing that — it hasn't been saved. Try again in a moment.");
    }
  }

  if (results.length) {
    const auto = results.reduce((s, r) => s + r.auto, 0);
    const held = results.reduce((s, r) => s + r.held, 0);
    await heartbeatOk(HEARTBEAT_ENV, `msgs=${messages.length} auto=${auto} held=${held}`);
  }

  return res.status(200).json({ ok: true, handled: results.length });
}
