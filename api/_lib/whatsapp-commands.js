/**
 * api/_lib/whatsapp-commands.js — clearing the review queue from WhatsApp
 * (owner decision 2026-09-22: approvals in "WhatsApp + Omni"; AUTOMATION_PLAN §4.4).
 *
 *   "review" / "?"          → numbered digest of what's waiting
 *   "✅" / "ok"             → approve every item that is ready
 *   "ok 1 3"                → approve those
 *   "no 2"                  → reject that one
 *   "fix 3 18 fuel"         → correct item 3 (amount / category / name / scooter), then approve it
 *   "brief"                 → today's brief
 *
 * Numbers refer to the LAST digest this sender received (stored per sender), not
 * to the live queue — so "ok 1" followed by "no 2" still means the second line
 * of the list they are looking at.
 *
 * Only APPROVERS (WHATSAPP_APPROVER_NUMBERS) may approve, reject or fix: crew
 * can report repairs and receipts, but never sign off money. Fails closed.
 */
import { missingForApproval, canonicalCategory } from '../../src/utils/intake.js';

const KIND_LABELS = {
  cost: 'Expense',
  ledger: 'Paid personally',
  ticket: 'Repair',
  issue: 'Issue',
  task: 'Task',
  loan_payment: 'Loan payment',
  recurring: 'Recurring bill',
  parts_receipt: 'Parts delivery',
};

const money = (n) => `€${(Number(n) || 0).toFixed(2)}`;
const digits = (s) => String(s || '').replace(/\D/g, '');
const numbersIn = (s) => [...new Set(String(s).split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0))];

/** Parse a queue command. Anything else returns null (and is routed as a capture). */
export function parseCommand(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (/^(✅|👍|ok|okay|ναι|εντάξει|εντάξει όλα|approve|approve all|εγκρίνω)$/i.test(t)) return { cmd: 'approve_all' };
  let m = t.match(/^(?:ok|approve|ναι|✅)\s+([\d][\d,\s]*)$/i);
  if (m) return { cmd: 'approve', numbers: numbersIn(m[1]) };
  m = t.match(/^(?:no|όχι|οχι|reject|skip|❌)\s+([\d][\d,\s]*)$/i);
  if (m) return { cmd: 'reject', numbers: numbersIn(m[1]) };
  m = t.match(/^(?:fix|διόρθωσε|διορθωσε)\s+(\d+)\s+([\s\S]+)$/i);
  if (m) return { cmd: 'fix', number: Number(m[1]), text: m[2].trim() };
  if (/^(review|pending|list|λίστα|λιστα|εκκρεμότητες|εκκρεμοτητες|\?)$/i.test(t)) return { cmd: 'list' };
  if (/^(brief|σύνοψη|συνοψη|αναφορά|αναφορα)$/i.test(t)) return { cmd: 'brief' };
  return null;
}

/** May this number approve money? Explicit allowlist only — unset means nobody. */
export function approverAllowed(from) {
  const list = (process.env.WHATSAPP_APPROVER_NUMBERS || '').split(',').map(digits).filter(Boolean);
  const d = digits(from);
  return list.length > 0 && list.some((a) => d.endsWith(a.slice(-9)));
}

/** The owner a WhatsApp sender is, by display name (same rule as the Review page). */
export function ownerForSender(owners = [], senderName) {
  const name = String(senderName || '').toLowerCase();
  if (!name) return owners.length === 1 ? owners[0]._docId : null;
  const hit = owners.find((o) => String(o.displayName || '').toLowerCase().includes(name));
  return hit?._docId || null;
}

/** What an approval from this sender fills in by default ("I paid it" → the sender). */
export function defaultOverrides(item, { owners = [], senderName = null } = {}) {
  if (item?.kind === 'ledger' && !item.payload?.ownerUid) {
    const uid = ownerForSender(owners, item.evidence?.senderName || senderName);
    return uid ? { ownerUid: uid } : {};
  }
  return {};
}

/** The numbered list a sender sees. */
export function digestText(pending, { owners = [], senderName = null, limit = 12 } = {}) {
  if (!pending.length) return 'Nothing waiting for review. 👌';
  const shown = pending.slice(0, limit);
  let ready = 0;
  const lines = shown.map(({ item }, i) => {
    const p = item.payload || {};
    const missing = missingForApproval(item, defaultOverrides(item, { owners, senderName }));
    if (!missing) ready += 1;
    return `${i + 1}. ${KIND_LABELS[item.kind] || item.kind}: ${p.name || 'Unnamed'}`
      + `${Number(p.amount) > 0 ? ` ${money(p.amount)}` : ''}`
      + `${missing ? ` — needs ${missing}` : ''}`;
  });
  const total = pending.reduce((s, x) => s + (Number(x.item.payload?.amount) || 0), 0);
  return [
    `${pending.length} waiting${total > 0 ? ` · ${money(total)}` : ''}:`,
    ...lines,
    pending.length > limit ? `…and ${pending.length - limit} more in Omni → Review.` : null,
    '',
    ready ? `Reply ✅ to approve the ${ready} ready · "no 2" to drop one · "fix 3 18 fuel" to correct one.`
      : 'Each needs one detail — "fix 1 <what>" or open Omni → Review.',
  ].filter((l) => l !== null).join('\n');
}

/**
 * Turn a correction ("18 fuel", "41735", "category parts", "JYSK 124") into
 * overrides, using the capture router's reading of the text.
 */
export function overridesFromCorrection(routed = {}, item = {}) {
  const out = {};
  if (Number(routed.amount) > 0) out.amount = Number(routed.amount);
  const cat = canonicalCategory(routed.category);
  if (cat) out.category = cat;
  if (routed.scooterId) out.scooterId = digits(routed.scooterId);
  if (routed.date) out.date = routed.date;
  // Rename only when the correction clearly names something (not just "fuel").
  if (routed.name && item.kind !== 'ticket' && routed.name.length > 2 && !canonicalCategory(routed.name)) out.name = routed.name;
  return out;
}

/** Resolve digest numbers to queue entries using the sender's last digest. */
export function resolveNumbers(numbers, { lastDigestIds = null, pending = [] } = {}) {
  const byId = new Map(pending.map((x) => [x.sdid, x]));
  return numbers.map((n) => {
    if (Array.isArray(lastDigestIds) && lastDigestIds.length) {
      const sdid = lastDigestIds[n - 1];
      return { n, entry: sdid ? byId.get(sdid) || { sdid, gone: true } : null };
    }
    return { n, entry: pending[n - 1] || null };
  });
}
