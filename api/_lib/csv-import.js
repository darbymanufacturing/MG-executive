/**
 * api/_lib/csv-import.js — "send the export to Omni" (AUTOMATION_PLAN §4.5).
 *
 * The owner kept Hopp on CSV exports (2026-09-22: "Keep CSV uploads"), so the
 * automation is AROUND the file: forward the export to the Omni WhatsApp number
 * (or the intake mailbox) and it imports itself, exactly like the in-app
 * importers do — same parser, same ex-VAT rule, same city, same document ids:
 *
 *   Hopp trip analytics  → revenue days  (parseRevenueCSV + revenueImport.js,
 *                          mirrors RevenueContext.importRevenueDays: Firestore
 *                          authoritative #481 + the Supabase rows the app reads)
 *   Hopp repair log      → maintenance tickets (parseRepairLogCsv, the PME importer's
 *                          parser; ids from its stable per-repair key, so re-sending
 *                          a file never doubles a ticket)
 *
 * Unrecognised files return null so the caller can say so instead of guessing.
 */
import { supabaseAdmin } from './supabase-admin.js';
import { getDb } from './firebase-admin.js';
import { SUPABASE_TABLE, toSupabaseRow } from '../../src/lib/supabaseRowMap.js';
import { parseRevenueCSV } from '../../src/utils/csvParser.js';
import { parseRepairLogCsv } from '../../src/utils/parseRepairLogCsv.js';
import {
  prepareRevenueRows, revenueDocIdFor, fleetIdForCity, locationForImport,
} from '../../src/utils/revenueImport.js';
import { orgDocId } from '../../src/utils/orgDocId.js';
import { DEFAULT_CONFIG } from '../../src/utils/constants.js';

const CHUNK = 400;

/** Which importer a CSV belongs to, by its header row. */
export function detectCsvKind(csvText) {
  const header = String(csvText || '').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] || '';
  if (/(^|,)"?Date"?(,|$)/.test(header) && /Total paid revenue/i.test(header)) return 'revenue';
  const repair = parseRepairLogCsv(csvText);
  if (repair?.tickets?.length && !(repair.errors || []).some((e) => /missing|unrecognised/i.test(String(e)))) return 'repairs';
  return null;
}

async function loadRows(supa, table, orgId) {
  const { data, error } = await supa.from(table).select('source_doc_id, data').eq('org_id', orgId);
  if (error) return [];
  return (data || []).map((r) => ({ ...(r.data || {}), _docId: r.source_doc_id }));
}

/**
 * Import a Hopp trip-analytics export.
 * @returns {{kind:'revenue', days, from, to, location, amountsIncludeVat, errors}}
 */
export async function importRevenueCsvServer({ orgId, csvText, caption = '', by = 'autopilot' }) {
  const parsed = parseRevenueCSV(csvText);
  if (!parsed.rows.length) {
    return { kind: 'revenue', days: 0, errors: parsed.errors || ['No rows in the file'] };
  }

  const supa = supabaseAdmin();
  const [{ data: cfgRow }, fleets] = await Promise.all([
    supa.from(SUPABASE_TABLE.config).select('data').eq('source_doc_id', `${orgId}_fleet`).maybeSingle(),
    loadRows(supa, SUPABASE_TABLE.fleets, orgId),
  ]);
  const cfg = cfgRow?.data || {};
  const choice = cfg.revenueImport || {};
  const location = locationForImport({ caption, locations: cfg.locations || [], lastLocation: choice.location || null });
  const vatRate = cfg.financial?.vatRate ?? DEFAULT_CONFIG.financial.vatRate;
  const rows = prepareRevenueRows(parsed.rows, { amountsIncludeVat: Boolean(choice.amountsIncludeVat), vatRate, location });

  const fleetId = fleetIdForCity(fleets, location);
  const entries = rows.map((day) => ({
    id: revenueDocIdFor(orgId, day),
    data: {
      ...day, orgId, createdByUid: by, source: 'autopilot-csv', ...(fleetId ? { fleetId } : {}),
    },
  }));

  // Firestore first — authoritative for revenue (#481), exactly like the app.
  const db = getDb();
  for (let i = 0; i < entries.length; i += CHUNK) {
    const batch = db.batch();
    for (const e of entries.slice(i, i + CHUNK)) batch.set(db.collection('revenue').doc(e.id), e.data);
    await batch.commit();
  }
  // The Supabase rows the app and the daily brief read (ADR-0013).
  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK).map((e) => toSupabaseRow('revenue', orgId, e.id, e.data));
    const { error } = await supa.from(SUPABASE_TABLE.revenue).upsert(chunk, { onConflict: 'source_doc_id' });
    if (error) throw new Error(`revenue rows: ${error.message}`);
  }

  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  return {
    kind: 'revenue',
    days: rows.length,
    from: dates[0] || null,
    to: dates[dates.length - 1] || null,
    location,
    amountsIncludeVat: Boolean(choice.amountsIncludeVat),
    errors: parsed.errors || [],
  };
}

/**
 * Import a Hopp repair-log export as maintenance tickets.
 * @returns {{kind:'repairs', tickets, errors}}
 */
export async function importRepairLogServer({ orgId, csvText, by = 'autopilot' }) {
  const parsed = parseRepairLogCsv(csvText);
  const list = parsed.tickets || [];
  if (!list.length) return { kind: 'repairs', tickets: 0, errors: parsed.errors || ['No rows in the file'] };

  const supa = supabaseAdmin();
  const existing = await loadRows(supa, SUPABASE_TABLE.maintenanceTickets, orgId);
  // A repair already in Omni (imported on screen earlier, or typed) is skipped —
  // re-sending last week's export must not double every ticket.
  const key = (t) => `${String(t.scooterId || '').trim()}|${t.dateEntered || ''}|${String(t.issueDescription || '').trim().toLowerCase()}`;
  const known = new Set(existing.map(key));
  const now = new Date().toISOString();
  const fresh = list.filter((t) => !known.has(key(t)));
  const rows = fresh.map(({ _docId, ...t }) => toSupabaseRow(
    'maintenanceTickets', orgId,
    // The parser's own stable key (scooter + date + description hash), org-prefixed:
    // the same file sent twice upserts the same documents.
    orgDocId(orgId, _docId),
    { ...t, source: 'autopilot-csv', createdByUid: by, createdAt: now, updatedAt: now },
  ));
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supa.from(SUPABASE_TABLE.maintenanceTickets).upsert(rows.slice(i, i + CHUNK), { onConflict: 'source_doc_id' });
    if (error) throw new Error(`tickets: ${error.message}`);
  }
  return {
    kind: 'repairs', tickets: rows.length, skipped: list.length - fresh.length, errors: parsed.errors || [],
  };
}
