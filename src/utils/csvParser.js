/**
 * CSV Parser for XSlide trip analytics export format.
 * Handles: '-' null values, comma-in-number thousands separators, "DD MMM YYYY" dates.
 */

const MONTH_MAP = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04',
  May: '05', Jun: '06', Jul: '07', Aug: '08',
  Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

/** Parse "08 Apr 2026" → "2026-04-08" */
function parseDate(val) {
  const clean = val.replace(/"/g, '').trim();
  const parts = clean.split(' ');
  if (parts.length !== 3) return null;
  const [day, mon, year] = parts;
  const month = MONTH_MAP[mon];
  if (!month) return null;
  return `${year}-${month}-${day.padStart(2, '0')}`;
}

/** Parse a numeric CSV field. Returns 0 for "'-", empty, or invalid. */
function parseNum(val) {
  if (!val) return 0;
  const clean = val.replace(/"/g, '').trim();
  if (clean === "'-" || clean === '' || clean === '-') return 0;
  // Strip thousands separators (commas)
  const stripped = clean.replace(/,/g, '');
  const num = parseFloat(stripped);
  return isNaN(num) ? 0 : num;
}

/**
 * Parse a single quoted CSV row into an array of raw string values.
 * Handles "" escaped double-quotes within quoted fields.
 * Exported as parseCSVRow so other parsers can reuse the canonical implementation. (#213)
 */
export function parseCSVRow(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // Handle escaped double-quotes ("") within quoted fields
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current.trim());
  return values;
}

const EXPECTED_HEADERS = [
  'Date', 'VAT rate', 'Currency', 'Total trips', 'Free trips', 'Penalty trips',
  'Total ride trip minutes', 'Total paused trip minutes', 'Total trip distance (km)',
  'Unique users count', 'Unique vehicles count', 'Total raw income',
  'Total free trip worth', 'Total raw refunds', 'Total vat', 'Refunded vat',
  'Unpaid user revenue', 'User debt refunds', 'Unpaid org revenue', 'Org debt refunds',
  'Total paid debt', 'Average payment', 'Average worth', 'Total paid revenue',
  'Total paid refunds',
];

/**
 * Parse a full CSV string into an array of revenue day objects.
 * Returns { rows: [...], errors: [...], total: n }
 */
export function parseRevenueCSV(csvText) {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return { rows: [], errors: ['File appears to be empty or has no data rows.'], total: 0 };
  }

  // Validate header
  const headerValues = parseCSVRow(lines[0]);
  const missing = EXPECTED_HEADERS.filter((h) => !headerValues.includes(h));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [`Unrecognised CSV format. Missing columns: ${missing.join(', ')}`],
      total: 0,
    };
  }

  // Build column index map
  const idx = {};
  EXPECTED_HEADERS.forEach((h) => { idx[h] = headerValues.indexOf(h); });

  const rows = [];
  const errors = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVRow(lines[i]);
    // #76 — warn when a row has more columns than expected (silently truncated data)
    if (cols.length > EXPECTED_HEADERS.length) {
      errors.push(`Row ${i + 1}: has ${cols.length} columns but expected ${EXPECTED_HEADERS.length} — check CSV format for extra commas.`);
    }
    const date = parseDate(cols[idx['Date']] || '');
    if (!date) {
      errors.push(`Row ${i + 1}: Could not parse date "${cols[idx['Date']]}"`);
      continue;
    }

    rows.push({
      date,
      vatRate:               parseNum(cols[idx['VAT rate']]),
      currency:              (cols[idx['Currency']] || 'EUR').replace(/"/g, '').trim(),
      totalTrips:            parseNum(cols[idx['Total trips']]),
      freeTrips:             parseNum(cols[idx['Free trips']]),
      penaltyTrips:          parseNum(cols[idx['Penalty trips']]),
      totalRideTripMinutes:  parseNum(cols[idx['Total ride trip minutes']]),
      totalPausedTripMinutes:parseNum(cols[idx['Total paused trip minutes']]),
      totalTripDistanceKm:   parseNum(cols[idx['Total trip distance (km)']]),
      uniqueUsersCount:      parseNum(cols[idx['Unique users count']]),
      uniqueVehiclesCount:   parseNum(cols[idx['Unique vehicles count']]),
      totalRawIncome:        parseNum(cols[idx['Total raw income']]),
      totalFreeTripWorth:    parseNum(cols[idx['Total free trip worth']]),
      totalRawRefunds:       parseNum(cols[idx['Total raw refunds']]),
      totalVat:              parseNum(cols[idx['Total vat']]),
      refundedVat:           parseNum(cols[idx['Refunded vat']]),
      unpaidUserRevenue:     parseNum(cols[idx['Unpaid user revenue']]),
      userDebtRefunds:       parseNum(cols[idx['User debt refunds']]),
      unpaidOrgRevenue:      parseNum(cols[idx['Unpaid org revenue']]),
      orgDebtRefunds:        parseNum(cols[idx['Org debt refunds']]),
      totalPaidDebt:         parseNum(cols[idx['Total paid debt']]),
      averagePayment:        parseNum(cols[idx['Average payment']]),
      averageWorth:          parseNum(cols[idx['Average worth']]),
      totalPaidRevenue:      parseNum(cols[idx['Total paid revenue']]),
      totalPaidRefunds:      parseNum(cols[idx['Total paid refunds']]),
      importedAt:            new Date().toISOString(),
    });
  }

  return { rows, errors, total: rows.length };
}
