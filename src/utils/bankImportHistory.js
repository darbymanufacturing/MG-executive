/**
 * bankImportHistory — answer "how current is my bank data, and what do I export next?"
 * derived entirely from the cost rows the CSV import already writes. No new table.
 *
 * Why this works: `CostContext.importBankCosts` computes ONE `createdAt` timestamp per
 * upload and stamps it on every row of that import (CostContext.jsx — `const now` is
 * hoisted above the write loop). So grouping bank rows by their exact `createdAt`
 * reconstructs each upload batch precisely — no fuzzy time-clustering needed.
 *
 * Pure + side-effect-free; pass `now` to make it testable (mirrors upcomingPayments.js).
 */

/** The `source` tag written by the Alpha Bank CSV import path. */
export const BANK_CSV_SOURCE = 'alphabank-csv';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Parse 'YYYY-MM-DD' → local-midnight Date, or null. */
function parseISODate(str) {
  if (!str) return null;
  const [y, m, d] = String(str).split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

const atMidnight = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** 'YYYY-MM-DD' for a Date. */
function toISODate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Whole calendar days between two 'YYYY-MM-DD' strings (b − a), or null. */
export function daysBetween(aISO, bISO) {
  const a = parseISODate(aISO);
  const b = parseISODate(bISO);
  if (!a || !b) return null;
  return Math.round((atMidnight(b) - atMidnight(a)) / MS_PER_DAY);
}

/** The day after `iso` — the date the next export should start from. */
export function dayAfter(iso) {
  const d = parseISODate(iso);
  if (!d) return null;
  return toISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
}

/**
 * Build the bank-import status view.
 *
 * @param {Array}  costs   all cost rows (org-scoped; bank data is company-wide, not fleet-scoped)
 * @param {Object} opts    { now = new Date(), source = BANK_CSV_SOURCE }
 * @returns {{
 *   count: number,                       // total imported bank transactions
 *   latestTxn: string|null,              // 'YYYY-MM-DD' of the most recent transaction
 *   earliestTxn: string|null,
 *   daysSinceLatest: number|null,        // calendar days from latestTxn → today
 *   nextExportFrom: string|null,         // the day after latestTxn
 *   batches: Array<{ importedAt, count, earliest, latest, total }>,  // newest upload first
 * }}
 */
export function bankImportHistory(costs, { now = new Date(), source = BANK_CSV_SOURCE } = {}) {
  const rows = (Array.isArray(costs) ? costs : []).filter(
    (c) => c && c.source === source && c.startDate,
  );

  const empty = {
    count: 0, latestTxn: null, earliestTxn: null,
    daysSinceLatest: null, nextExportFrom: null, batches: [],
  };
  if (!rows.length) return empty;

  // One upload = one exact createdAt (see header note).
  const byUpload = new Map();
  for (const r of rows) {
    const key = r.createdAt || 'unknown';
    if (!byUpload.has(key)) byUpload.set(key, []);
    byUpload.get(key).push(r);
  }

  const batches = [...byUpload.entries()]
    .map(([importedAt, list]) => {
      const dates = list.map((r) => r.startDate).sort();
      return {
        importedAt,
        count: list.length,
        earliest: dates[0],
        latest: dates[dates.length - 1],
        total: list.reduce((s, r) => s + (Number(r.amount) || 0), 0),
      };
    })
    // newest upload first ('unknown' sorts last)
    .sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt)));

  const allDates = rows.map((r) => r.startDate).sort();
  const earliestTxn = allDates[0];
  const latestTxn = allDates[allDates.length - 1];
  const todayISO = toISODate(atMidnight(now instanceof Date ? now : new Date()));

  return {
    count: rows.length,
    latestTxn,
    earliestTxn,
    daysSinceLatest: daysBetween(latestTxn, todayISO),
    nextExportFrom: dayAfter(latestTxn),
    batches,
  };
}

/**
 * Freshness bucket for the "latest transaction" badge.
 * green ≤ 7d · amber ≤ 30d · red > 30d (null when there's no data).
 */
export function freshnessLevel(daysSinceLatest) {
  if (daysSinceLatest == null) return 'muted';
  if (daysSinceLatest <= 7) return 'green';
  if (daysSinceLatest <= 30) return 'amber';
  return 'red';
}

/** Human label for how old the latest transaction is. */
export function freshnessLabel(daysSinceLatest) {
  if (daysSinceLatest == null) return '—';
  if (daysSinceLatest <= 0) return 'Today';
  if (daysSinceLatest === 1) return 'Yesterday';
  if (daysSinceLatest < 30) return `${daysSinceLatest} days ago`;
  const months = Math.round(daysSinceLatest / 30);
  return months <= 1 ? 'Over a month ago' : `~${months} months ago`;
}
