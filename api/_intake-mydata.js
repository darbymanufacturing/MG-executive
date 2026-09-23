/**
 * api/intake-mydata.js — pull the company's PURCHASE invoices from AADE myDATA
 * into the Autopilot intake queue (docs/AUTOMATION_PLAN.md §4.2).
 *
 * Every Greek B2B invoice issued TO this company is transmitted to myDATA by the
 * supplier, with the exact VAT split and a unique MARK. That makes myDATA the
 * most authoritative expense source Omni can have — better than OCR'ing a PDF —
 * and it becomes near-complete when e-invoicing turns mandatory for all Greek
 * businesses on 2026-10-01.
 *
 * METHOD — RequestDocs, not RequestMyExpenses (#704). RequestMyExpenses returns
 * AGGREGATED `bookInfo` rows (one per supplier ΑΦΜ + date + type, with a count
 * and a min/max MARK), so an invoice-level parser found nothing in it. RequestDocs
 * returns the individual documents other parties transmitted where this company
 * is the counterpart — i.e. its purchase invoices — each with its MARK:
 *   GET {base}/RequestDocs?mark=0&dateFrom=dd/MM/yyyy&dateTo=dd/MM/yyyy
 *        [&nextPartitionKey=…&nextRowKey=…]
 *   → <RequestedDoc><continuationToken>…</continuationToken>
 *       <invoicesDoc><invoice><mark/><issuer><vatNumber/>…</issuer>
 *         <invoiceHeader><series/><aa/><issueDate/><invoiceType/></invoiceHeader>
 *         <invoiceSummary><totalNetValue/><totalVatAmount/><totalGrossValue/></invoiceSummary>
 *       </invoice>…</invoicesDoc>
 *       <cancelledInvoicesDoc><cancelledInvoice><invoiceMark/>…</cancelledInvoice></cancelledInvoicesDoc>
 *     </RequestedDoc>
 * `mark=0` means "every MARK above 0"; the date window keeps each run small.
 *
 * KNOWN GAP (do not oversell): plain retail receipts (ΑΛΠ) are anonymous unless
 * someone re-declares them against the company ΑΦΜ, so fuel/shop receipts still
 * arrive via WhatsApp photos and the bank feed.
 *
 * Trigger: cron (Bearer CRON_SECRET) or an admin. A manual run may pass
 * ?from=YYYY-MM-DD to back-fill. Inert until credentials exist.
 *
 * Env:
 *   MYDATA_USER_ID           aade-user-id (created in myDATA → "Εγγραφή στο myDATA REST API")
 *   MYDATA_SUBSCRIPTION_KEY  Ocp-Apim-Subscription-Key
 *   MYDATA_BASE_URL          default https://mydatapi.aade.gr/myDATA
 *                            (sandbox: https://mydataapidev.aade.gr)
 *   MYDATA_LOOKBACK_DAYS     default 45
 */
import { requireCronOrUser, requireOrgMember } from './_lib/require-auth.js';
import { ingestBatch, intakeOrgId, saveAutopilotState, backfillFrom } from './_lib/intake-store.js';
import { heartbeatOk, heartbeatFail } from './_lib/heartbeat.js';

const HEARTBEAT_ENV = 'HEARTBEAT_INTAKE_MYDATA';
const DEFAULT_BASE = 'https://mydatapi.aade.gr/myDATA';
const TIMEOUT_MS = 20000;
const MAX_PAGES = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** dd/MM/yyyy — the only date format the myDATA REST API accepts. */
export const ddmmyyyy = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
};

/* ── tiny XML helpers ──────────────────────────────────────────────────────
 * myDATA returns XML. The app deliberately carries no XML/CSV parser deps
 * (CLAUDE.md: custom parsing, no PapaParse), and we need a handful of fields, so
 * a scoped tag scanner is the right size of tool. The tag name must END where
 * the pattern says (`<invoice>` must not match `<invoiceHeader>` or
 * `<invoicesDoc>`). Exported for tests. */

const stripNs = (xml) => xml.replace(/<(\/?)[A-Za-z0-9_]+:/g, '<$1');

const tagRe = (tag, flags) => new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, flags);

export function tagValue(xml, tag) {
  const m = tagRe(tag).exec(xml);
  return m ? m[1].trim() : null;
}

export function tagBlocks(xml, tag) {
  const re = tagRe(tag, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

const sumTag = (xml, tag) =>
  tagBlocks(xml, tag).reduce((s, v) => s + (Number(String(v).trim()) || 0), 0);

/**
 * Parse one RequestDocs page into intake raws — one per purchase invoice.
 * Credit notes (5.x) and invoices the issuer cancelled are dropped: neither is
 * spend. Exported so the shape is testable without hitting AADE.
 */
export function parseMyDataInvoices(xmlRaw) {
  const xml = stripNs(String(xmlRaw || ''));
  const cancelled = new Set(
    tagBlocks(xml, 'cancelledInvoice').map((b) => tagValue(b, 'invoiceMark')).filter(Boolean),
  );
  const items = [];

  for (const block of tagBlocks(xml, 'invoice')) {
    const mark = tagValue(block, 'mark');
    if (!mark || cancelled.has(mark)) continue;

    const issuerBlock = tagBlocks(block, 'issuer')[0] || '';
    const vatNumber = tagValue(issuerBlock, 'vatNumber');
    const issuerName = tagValue(issuerBlock, 'name'); // foreign issuers only
    const header = tagBlocks(block, 'invoiceHeader')[0] || block;
    const issueDate = tagValue(header, 'issueDate');
    const invoiceType = tagValue(header, 'invoiceType');
    const series = tagValue(header, 'series');
    const aa = tagValue(header, 'aa');

    const summary = tagBlocks(block, 'invoiceSummary')[0] || '';
    const gross = Number(tagValue(summary, 'totalGrossValue')) || 0;
    const net = Number(tagValue(summary, 'totalNetValue')) || 0;
    const vat = Number(tagValue(summary, 'totalVatAmount')) || sumTag(block, 'vatAmount');

    // 5.x are credit notes: they REDUCE a cost, so never import them as spend.
    const isCreditNote = String(invoiceType || '').startsWith('5.');

    items.push({
      sourceRef: String(mark),
      kind: 'cost',
      payload: {
        // Greek issuers transmit only their ΑΦΜ; the owner names the supplier on
        // the first approval and the ΑΦΜ rule names every later invoice.
        name: issuerName || (vatNumber ? `ΑΦΜ ${vatNumber}` : 'Supplier invoice'),
        amount: gross || net,
        date: issueDate,
        category: null,
        vatAmount: vat || null,
        notes: [invoiceType && `Type ${invoiceType}`, series && aa && `${series}/${aa}`]
          .filter(Boolean).join(' · ') || null,
        counterpartVat: vatNumber || null,
        isCreditNote,
      },
      evidence: { mydataMark: String(mark), invoiceType, series, aa },
    });
  }

  return items.filter((i) => !i.payload.isCreditNote && i.payload.amount > 0);
}

export async function requestDocs({ base, userId, key, dateFrom, dateTo }) {
  const collected = [];
  let nextPartitionKey = null;
  let nextRowKey = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`${base.replace(/\/$/, '')}/RequestDocs`);
    url.searchParams.set('mark', '0');
    url.searchParams.set('dateFrom', dateFrom);
    url.searchParams.set('dateTo', dateTo);
    if (nextPartitionKey) url.searchParams.set('nextPartitionKey', nextPartitionKey);
    if (nextRowKey) url.searchParams.set('nextRowKey', nextRowKey);

    const res = await fetch(url, {
      headers: {
        'aade-user-id': userId,
        'Ocp-Apim-Subscription-Key': key,
        Accept: 'application/xml',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 429) { collected.rateLimited = true; break; } // throttled — resume next run
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`myDATA ${res.status}: ${body.slice(0, 200)}`);
    }

    const xml = await res.text();
    collected.push(xml);

    const cleaned = stripNs(xml);
    nextPartitionKey = tagValue(cleaned, 'nextPartitionKey');
    nextRowKey = tagValue(cleaned, 'nextRowKey');
    if (!nextPartitionKey || !nextRowKey) break;
  }

  return collected;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireCronOrUser(req, res);
  if (!auth) return;
  const orgId = intakeOrgId();
  if (!requireOrgMember(auth, orgId, res)) return;

  const userId = process.env.MYDATA_USER_ID;
  const key = process.env.MYDATA_SUBSCRIPTION_KEY;
  if (!userId || !key) {
    return res.status(503).json({
      ok: false,
      error: 'myDATA sync is not configured. Set MYDATA_USER_ID and MYDATA_SUBSCRIPTION_KEY in Vercel (aade.gr → myDATA → Εγγραφή στο myDATA REST API).',
    });
  }

  const base = process.env.MYDATA_BASE_URL || DEFAULT_BASE;
  const lookback = Number(process.env.MYDATA_LOOKBACK_DAYS || 45);
  const now = new Date();
  const backfill = backfillFrom(req.query, auth, now);
  const from = backfill ? new Date(`${backfill}T00:00:00Z`) : new Date(now.getTime() - lookback * DAY_MS);

  try {
    const pages = await requestDocs({
      base, userId, key, dateFrom: ddmmyyyy(from), dateTo: ddmmyyyy(now),
    });
    const raws = pages.flatMap(parseMyDataInvoices);
    const report = await ingestBatch(raws, { source: 'mydata', orgId, now });

    await saveAutopilotState(orgId, {
      lastSync: { mydata: { at: now.toISOString(), from: from.toISOString().slice(0, 10), backfill: Boolean(backfill), invoices: raws.length, ...report } },
    });
    await heartbeatOk(
      HEARTBEAT_ENV,
      `invoices=${raws.length} auto=${report.auto} held=${report.held}`,
    );
    return res.status(200).json({
      ok: true,
      window: { from: ddmmyyyy(from), to: ddmmyyyy(now), backfill: Boolean(backfill) },
      pages: pages.length,
      rateLimited: Boolean(pages.rateLimited),
      invoices: raws.length,
      ...report,
    });
  } catch (err) {
    const message = err?.message || String(err);
    console.error('[intake-mydata]', message);
    await heartbeatFail(HEARTBEAT_ENV, message.slice(0, 200));
    return res.status(502).json({ ok: false, error: message });
  }
}
