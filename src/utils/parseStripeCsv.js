/**
 * CSV parser for Stripe "unified payments" exports — XSlide platform revenue.
 * Aggregates individual charges into one row per Europe/Athens calendar day,
 * matching the day-granularity contract of parseRevenueCSV (csvParser.js), so
 * the import panel can treat both revenue sources identically.
 *
 * Two things this format gets wrong if handled naively:
 *   - `Amount` is the AUTHORIZED amount, not what was captured — a €3 pre-auth
 *     partially captured at €1.90 still shows `Amount: 3.00`. `Converted Amount`
 *     (minus `Converted Amount Refunded`) is the real settled amount — it's also
 *     what `Fee` is computed from. NEVER read `Amount` for revenue.
 *   - `Created date (UTC)` must be bucketed in Europe/Athens, not UTC — roughly
 *     1 in 4 charges near midnight lands on a different calendar day otherwise.
 */
import { parseCSVRow } from './csvParser.js';

const STRIPE_EXPECTED_HEADERS = [
  'id', 'Created date (UTC)', 'Status', 'Captured',
  'Converted Amount', 'Converted Amount Refunded', 'Converted Currency',
  'Fee', 'user_id (metadata)',
];

// Escape hatch for future export columns, mirroring csvParser.js's
// OPTIONAL_HEADERS pattern (#683) — none needed yet.
const OPTIONAL_HEADERS = [];

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Parse a plain Stripe numeric field (no thousands separators). */
function parseAmount(val) {
  if (!val) return 0;
  const n = Number(val.replace(/"/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

/** "2026-08-18 19:26:50" (always UTC per the export) → a real Date, or null. */
function parseStripeTimestamp(val) {
  if (!val) return null;
  const clean = val.replace(/"/g, '').trim();
  const d = new Date(`${clean.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const athensDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Athens', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** A UTC Date → its calendar day in Europe/Athens, as "YYYY-MM-DD". */
function athensDay(date) {
  return athensDayFormatter.format(date);
}

/**
 * Parse a Stripe "unified payments" CSV export into per-day revenue rows.
 * Returns { rows: [...], errors: [...], total: n, skipped: n } — the same
 * contract as parseRevenueCSV.
 *
 * Each row: { date, grossInclVat, chargeCount, uniqueUsersCount, stripeFees, chargeIds }.
 * `grossInclVat` is the raw settled total (Converted Amount − refunds) for that
 * day — VAT is NOT stripped here; that happens once, at commit time, in the
 * import panel (mirrors CsvImportPanel's stripVatFromRow so preview and commit
 * can never disagree or double-strip).
 */
export function parseStripeCSV(csvText) {
  if (csvText.charCodeAt(0) === 0xFEFF) csvText = csvText.slice(1);
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return { rows: [], errors: ['File appears to be empty or has no data rows.'], total: 0, skipped: 0 };
  }

  const headerValues = parseCSVRow(lines[0]);
  const missing = STRIPE_EXPECTED_HEADERS.filter((h) => !headerValues.includes(h));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [`Unrecognised CSV format. Missing columns: ${missing.join(', ')}`],
      total: 0,
      skipped: 0,
    };
  }

  const idx = {};
  [...STRIPE_EXPECTED_HEADERS, ...OPTIONAL_HEADERS].forEach((h) => { idx[h] = headerValues.indexOf(h); });

  const byDay = new Map();
  const errors = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVRow(lines[i]);
    // #76/#683 pattern — warn on a row wider than the file's own header, but
    // still try to process it (a stray comma shifts columns; it's a warning,
    // not necessarily a fatal skip).
    if (cols.length > headerValues.length) {
      errors.push(`Row ${i + 1}: has ${cols.length} columns but the header has ${headerValues.length} — check CSV format for extra commas.`);
    }

    const statusRaw = cols[idx.Status] || '';
    const capturedRaw = cols[idx.Captured] || '';
    const status = statusRaw.trim().toLowerCase();
    const captured = capturedRaw.trim().toLowerCase();
    if (status !== 'paid' || captured !== 'true') {
      skipped++;
      errors.push(`Row ${i + 1}: skipped — status "${statusRaw}"${captured !== 'true' ? ', not captured' : ''}`);
      continue;
    }

    const currencyRaw = cols[idx['Converted Currency']] || '';
    if (currencyRaw.trim().toLowerCase() !== 'eur') {
      skipped++;
      errors.push(`Row ${i + 1}: skipped — unsupported currency "${currencyRaw}" (expected EUR)`);
      continue;
    }

    const createdRaw = cols[idx['Created date (UTC)']];
    const createdAt = parseStripeTimestamp(createdRaw);
    if (!createdAt) {
      skipped++;
      errors.push(`Row ${i + 1}: could not parse date "${createdRaw}"`);
      continue;
    }

    const day = athensDay(createdAt);
    const settled = round2(
      parseAmount(cols[idx['Converted Amount']]) - parseAmount(cols[idx['Converted Amount Refunded']]),
    );
    const fee = parseAmount(cols[idx.Fee]);
    const chargeId = (cols[idx.id] || '').trim() || null;
    const userId = (cols[idx['user_id (metadata)']] || '').trim() || null;

    if (!byDay.has(day)) {
      byDay.set(day, {
        date: day, grossInclVat: 0, chargeCount: 0, stripeFees: 0, chargeIds: [], _users: new Set(),
      });
    }
    const bucket = byDay.get(day);
    bucket.grossInclVat = round2(bucket.grossInclVat + settled);
    bucket.chargeCount += 1;
    bucket.stripeFees = round2(bucket.stripeFees + fee);
    if (chargeId) bucket.chargeIds.push(chargeId);
    if (userId) bucket._users.add(userId);
  }

  const rows = [...byDay.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ _users, ...rest }) => ({ ...rest, uniqueUsersCount: _users.size }));

  return { rows, errors, total: rows.length, skipped };
}
