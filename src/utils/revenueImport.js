/**
 * revenueImport.js — turning a parsed Hopp trip-analytics CSV into the revenue
 * rows Omni stores. Shared by the in-app importer (Revenue → CsvImportPanel) and
 * the "send the export to Omni" path (WhatsApp / email, AUTOMATION_PLAN §4.5), so
 * a file dropped in a chat imports exactly like one uploaded on screen.
 *
 * Pure: no React, no Supabase.
 */
import { stripVat } from './vat.js';
import { orgDocId } from './orgDocId.js';

// Monetary fields on a parsed revenue row that are eligible for VAT stripping when
// the source CSV reports gross (VAT-included) amounts. Deliberately EXCLUDES:
// - `totalVat` / `refundedVat` — already-computed VAT figures from the export, not
//   gross amounts to strip VAT out of;
// - `vatRate` — metadata (the export's own rate), not a monetary amount;
// - trip counts, durations, distance, unique users/vehicles — non-monetary.
export const VAT_ADJUSTABLE_FIELDS = Object.freeze([
  'totalRawIncome',
  'totalFreeTripWorth',
  'totalRawRefunds',
  'unpaidUserRevenue',
  'userDebtRefunds',
  'unpaidOrgRevenue',
  'orgDebtRefunds',
  'totalPaidDebt',
  'averagePayment',
  'averageWorth',
  'totalPaidRevenue',
  'totalPaidRefunds',
]);

/** A copy of `row` with every VAT-adjustable monetary field stripped of VAT. */
export function stripVatFromRow(row, rate) {
  const adjusted = { ...row };
  VAT_ADJUSTABLE_FIELDS.forEach((field) => {
    if (typeof row[field] === 'number') {
      adjusted[field] = stripVat(row[field], rate);
    }
  });
  return adjusted;
}

/**
 * The rows to store: VAT stripped when the owner said the export's amounts
 * include VAT (revenue is stored EX-VAT — app convention), each tagged with
 * the city it belongs to.
 */
export function prepareRevenueRows(parsedRows = [], { amountsIncludeVat = false, vatRate, location = null } = {}) {
  return parsedRows.map((r) => ({
    ...(amountsIncludeVat ? stripVatFromRow(r, vatRate) : r),
    location: location || null,
  }));
}

/** Deterministic, org-prefixed id: one row per org + date + city (ADR-0002). */
export const revenueDocIdFor = (orgId, row) => orgDocId(orgId, row.date, row.location || 'global');

/**
 * The fleet a city belongs to (FF-3) — FleetContext.fleetForCity's rule for
 * callers without React: first fleet listing the city wins (case-insensitive).
 */
export function fleetIdForCity(fleets = [], city) {
  if (!city) return null;
  const key = String(city).toLowerCase();
  for (const f of fleets) {
    if ((f?.cities || []).some((c) => String(c).toLowerCase() === key)) return f._docId ?? f.id ?? null;
  }
  return null;
}

/**
 * Which city an export is for, when it arrives without the importer's dropdown:
 * a city named in the message caption wins, else the city of the owner's last
 * import. Only configured cities count — never a free-text guess.
 */
export function locationForImport({ caption = '', locations = [], lastLocation = null } = {}) {
  const text = String(caption || '').toLowerCase();
  const named = (locations || []).find((l) => l && text.includes(String(l).toLowerCase()));
  return named || lastLocation || null;
}
