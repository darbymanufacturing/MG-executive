/**
 * api/whatsapp.js — the Omni WhatsApp number (docs/AUTOMATION_PLAN.md §4.4).
 *
 * Send a photo of a receipt, a voice note ("41735 άλλαξα ντίζα φρένου, 25 λεπτά"),
 * a forwarded Hopp CSV, or just type — and it lands in Omni with its evidence
 * attached. Confident items file themselves; the rest wait in /review, and an
 * approver can clear that queue right here:
 *   "review" → numbered list · "✅" → approve the ready ones · "no 2" · "fix 3 18 fuel" · "brief"
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
 *      WHATSAPP_APPROVER_NUMBERS (who may approve/import — unset = nobody) ·
 *      WHATSAPP_APP_SECRET (optional, secondary) · ANTHROPIC_KEY ·
 *      GOOGLE_STT_API_KEY or OPENAI_API_KEY (voice notes)
 */
import {
  verifySignature, webhookKeyOk, senderAllowed, senderName, sendText, fetchMedia,
  routeMessage, routedToIntake, rateLimited,
} from './_lib/whatsapp.js';
import {
  parseCommand, approverAllowed, defaultOverrides, digestText, overridesFromCorrection, resolveNumbers,
} from './_lib/whatsapp-commands.js';
import { extractInvoice, extractionToIntake } from './_lib/invoice-extract.js';
import { transcribeAudio } from './_lib/transcribe.js';
import {
  ingestBatch, intakeOrgId, loadAutopilotState, saveAutopilotState,
} from './_lib/intake-store.js';
import {
  loadCommitContext, pendingIntake, approveOnServer, rejectOnServer,
} from './_lib/intake-commit.js';
import { detectCsvKind, importRevenueCsvServer, importRepairLogServer } from './_lib/csv-import.js';
import { storeReceipt } from './_lib/receipt-store.js';
import { supabaseAdmin } from './_lib/supabase-admin.js';
import { getDb } from './_lib/firebase-admin.js';
import { heartbeatOk, heartbeatFail } from './_lib/heartbeat.js';

const HEARTBEAT_ENV = 'HEARTBEAT_WHATSAPP';
const APPROVE_ALL_LIMIT = 20;

const money = (n) => `€${(Number(n) || 0).toFixed(2)}`;
const senderKey = (from) => String(from || '').replace(/\D/g, '');

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

const isCsv = (msg) => msg.type === 'document'
  && (/csv/i.test(msg.document?.mime_type || '') || /\.csv$/i.test(msg.document?.filename || ''));

/* ── queue commands ───────────────────────────────────────────────────────── */

async function todaysBrief(orgId) {
  const date = new Date().toISOString().slice(0, 10);
  const snap = await getDb().collection('briefs')
    .where('orgId', '==', orgId).where('date', '==', date).limit(1).get();
  const brief = snap.docs[0]?.data();
  if (!brief) return null;
  const sections = (brief.sections || []).slice(0, 4).map((s) => [
    `*${s.title}*`,
    ...(s.items || []).slice(0, 4).map((x) => `• ${x}`),
  ].join('\n'));
  return [brief.narrative, ...sections].filter(Boolean).join('\n\n').slice(0, 3800);
}

async function runCommand(command, { orgId, from, name }) {
  if (command.cmd === 'brief') {
    return (await todaysBrief(orgId)) || "Today's brief isn't ready yet — it's written at 07:00.";
  }

  const supa = supabaseAdmin();
  const [pending, data, state] = await Promise.all([
    pendingIntake(supa, orgId),
    loadCommitContext(supa, orgId),
    loadAutopilotState(orgId),
  ]);
  const digests = state.whatsappDigests || {};
  const mine = digests[senderKey(from)];
  const lastDigestIds = mine && Date.now() - Date.parse(mine.at) < 2 * 86_400_000 ? mine.ids : null;

  if (command.cmd === 'list') {
    await saveAutopilotState(orgId, {
      whatsappDigests: { ...digests, [senderKey(from)]: { at: new Date().toISOString(), ids: pending.slice(0, 12).map((x) => x.sdid) } },
    });
    return digestText(pending, { owners: data.owners, senderName: name });
  }

  const approve = async (entry, extra = {}) => {
    const overrides = { ...defaultOverrides(entry.item, { owners: data.owners, senderName: name }), ...extra };
    await approveOnServer(supa, orgId, entry.sdid, overrides, data, { via: 'whatsapp', by: `whatsapp:${name || senderKey(from)}` });
  };

  if (command.cmd === 'approve_all') {
    if (!pending.length) return 'Nothing waiting for review. 👌';
    // Bounded per message so the webhook answers inside Meta's window; the rest
    // go with the next ✅ (a re-delivered ✅ is harmless: decided items are skipped).
    const batch = pending.slice(0, APPROVE_ALL_LIMIT);
    let ok = 0;
    const waiting = [];
    for (const [i, entry] of batch.entries()) {
      try { await approve(entry); ok += 1; } catch (err) { waiting.push(`${i + 1} (${err.message})`); }
    }
    return [
      `✅ Approved ${ok}.`,
      waiting.length ? `Still waiting: ${waiting.slice(0, 6).join(' · ')}` : null,
      pending.length > batch.length ? `${pending.length - batch.length} more — send ✅ again.` : null,
    ].filter(Boolean).join('\n');
  }

  if (command.cmd === 'approve' || command.cmd === 'reject') {
    const lines = [];
    for (const { n, entry } of resolveNumbers(command.numbers, { lastDigestIds, pending })) {
      if (!entry || entry.gone) { lines.push(`${n}: already handled`); continue; }
      try {
        if (command.cmd === 'approve') { await approve(entry); lines.push(`${n}: ✅ approved`); } else {
          await rejectOnServer(supa, orgId, entry.sdid, { via: 'whatsapp', by: `whatsapp:${name || senderKey(from)}` });
          lines.push(`${n}: dropped`);
        }
      } catch (err) {
        lines.push(`${n}: ${err.message}`);
      }
    }
    return lines.join('\n') || 'Nothing matched those numbers — send "review" for the list.';
  }

  if (command.cmd === 'fix') {
    const [{ entry }] = resolveNumbers([command.number], { lastDigestIds, pending });
    if (!entry || entry.gone) return `${command.number}: already handled — send "review" for the current list.`;
    const routed = await routeMessage(command.text);
    const extra = overridesFromCorrection(routed, entry.item);
    if (!Object.keys(extra).length) return `I couldn't read a correction in "${command.text}". Try "fix ${command.number} 18,50 fuel".`;
    try {
      await approve(entry, extra);
      return `${command.number}: ✅ corrected and approved`;
    } catch (err) {
      return `${command.number}: ${err.message}`;
    }
  }
  return null;
}

/* ── handler ──────────────────────────────────────────────────────────────── */

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

  const orgId = intakeOrgId();
  const results = [];
  let commands = 0;
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
      const name = senderName(from);

      /* Queue commands ("review", "✅", "no 2", "fix 3 …", "brief"). */
      if (msg.type === 'text') {
        const command = parseCommand(msg.text?.body);
        if (command) {
          commands += 1;
          if (command.cmd !== 'brief' && !approverAllowed(from)) {
            await sendText(from, 'Only an approver can clear the review queue from WhatsApp — it is waiting in Omni → Review.');
            continue;
          }
          await sendText(from, await runCommand(command, { orgId, from, name }));
          continue;
        }
      }

      /* A forwarded Hopp export imports itself (the owner's CSV workflow, §4.5). */
      if (isCsv(msg)) {
        if (!approverAllowed(from)) {
          await sendText(from, 'Only an approver can import files — forward it to the owner.');
          continue;
        }
        const media = await fetchMedia(msg.document.id);
        const csvText = Buffer.from(media.base64, 'base64').toString('utf8');
        const kind = detectCsvKind(csvText);
        if (kind === 'revenue') {
          const r = await importRevenueCsvServer({ orgId, csvText, caption: msg.document?.caption, by: `whatsapp:${name || senderKey(from)}` });
          await sendText(from, r.days
            ? `📈 Imported ${r.days} revenue days${r.location ? ` for ${r.location}` : ''} (${r.from} → ${r.to}), ${r.amountsIncludeVat ? 'VAT stripped' : 'amounts ex-VAT'} like your last import.${r.errors.length ? ` ${r.errors.length} row(s) skipped.` : ''}`
            : `I couldn't import that file: ${r.errors[0] || 'no rows'}`);
        } else if (kind === 'repairs') {
          const r = await importRepairLogServer({ orgId, csvText, by: `whatsapp:${name || senderKey(from)}` });
          await sendText(from, `🔧 Imported ${r.tickets} repairs${r.skipped ? ` (${r.skipped} already in Omni)` : ''}.`);
        } else {
          await sendText(from, "I don't recognise that file. I can import Hopp's trip-analytics and repair-log exports.");
        }
        results.push({ auto: 0, held: 0 });
        continue;
      }

      let raws = [];
      let transcript = null;

      if (msg.type === 'text') {
        const routed = await routeMessage(msg.text?.body || '');
        if (routed.intent === 'question') {
          await sendText(from, 'I only file things for now. Ask me in the app — or send a receipt, a fault, or a task. Send "brief" for today\'s brief.');
          continue;
        }
        const item = routedToIntake(routed, { sourceRef: msg.id, from, transcript: msg.text?.body });
        if (item) raws = [item];
      } else if (msg.type === 'image' || msg.type === 'document') {
        const mediaId = msg.image?.id || msg.document?.id;
        const media = await fetchMedia(mediaId);
        const [extracted, fileUrl] = await Promise.all([
          extractInvoice({ base64: media.base64, mimeType: media.mimeType, hint: msg.image?.caption || msg.document?.caption }),
          // Keep the original for VAT audits; a failed upload never blocks the expense.
          storeReceipt(media, { orgId, ref: msg.id }),
        ]);
        raws = [extractionToIntake(extracted, {
          sourceRef: msg.id,
          evidence: { channel: 'whatsapp', from, filename: msg.document?.filename || null, fileUrl },
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

      // Who sent it — lets approvals pre-select the owner on "I paid it
      // personally" items (still confirmed by a human).
      raws = raws.map((r) => ({ ...r, evidence: { ...r.evidence, senderName: name } }));

      const report = await ingestBatch(raws, { source: 'whatsapp', orgId });
      results.push(report);

      const lines = [];
      // Echo the transcript so a Greek ASR slip is caught in seconds, not weeks.
      if (transcript) lines.push(`Heard: “${transcript.slice(0, 160)}”`);
      lines.push(summarize(report, raws));
      await sendText(from, lines.filter(Boolean).join('\n\n'));
    } catch (err) {
      console.error('[whatsapp]', err?.message || err);
      await heartbeatFail(HEARTBEAT_ENV, String(err?.message || err).slice(0, 200));
      if (from) await sendText(from, "Something went wrong with that — it hasn't been saved. Try again in a moment.");
    }
  }

  if (results.length || commands) {
    const auto = results.reduce((s, r) => s + (r.auto || 0), 0);
    const held = results.reduce((s, r) => s + (r.held || 0), 0);
    await heartbeatOk(HEARTBEAT_ENV, `msgs=${messages.length} auto=${auto} held=${held} commands=${commands}`);
  }

  return res.status(200).json({ ok: true, handled: results.length, commands });
}
