/**
 * CSV Parser for XSlide cost data (import/export format).
 */
import { v4 as uuidv4 } from 'uuid';
import { CATEGORY_KEYS, FREQUENCY_KEYS } from './constants.js';
import { todayISO } from './formatters.js';

const CATEGORY_SET  = new Set(CATEGORY_KEYS);
const FREQUENCY_SET = new Set(FREQUENCY_KEYS);

const EXPECTED_HEADERS = ['Name', 'Category', 'Frequency', 'Amount (EUR)', 'Start Date', 'End Date', 'Notes'];

/** Parse a single quoted CSV row into an array of raw string values. */
function parseRow(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
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

/**
 * Parse a cost CSV string into an array of cost objects.
 * Returns { rows: CostObject[], errors: string[], total: number }
 */
export function parseCostsCSV(csvText) {
  const lines = csvText.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return { rows: [], errors: ['File appears to be empty or has no data rows.'], total: 0 };
  }

  const headerValues = parseRow(lines[0]);
  const missing = EXPECTED_HEADERS.filter((h) => !headerValues.includes(h));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [`Unrecognised format. Missing columns: ${missing.join(', ')}`],
      total: 0,
    };
  }

  const idx = {};
  EXPECTED_HEADERS.forEach((h) => { idx[h] = headerValues.indexOf(h); });

  const rows = [];
  const errors = [];
  const now = new Date().toISOString();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseRow(lines[i]);
    const rowNum = i + 1;

    const name = cols[idx['Name']] || '';
    if (!name) { errors.push(`Row ${rowNum}: Name is required.`); continue; }

    const category = (cols[idx['Category']] || '').toLowerCase();
    if (!CATEGORY_SET.has(category)) {
      errors.push(`Row ${rowNum}: Invalid category "${category}". Must be one of: ${CATEGORY_KEYS.join(', ')}.`);
      continue;
    }

    const frequency = (cols[idx['Frequency']] || '').toLowerCase();
    if (!FREQUENCY_SET.has(frequency)) {
      errors.push(`Row ${rowNum}: Invalid frequency "${frequency}". Must be one of: ${FREQUENCY_KEYS.join(', ')}.`);
      continue;
    }

    const amountStr = (cols[idx['Amount (EUR)']] || '').replace(/,/g, '');
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount < 0) {
      errors.push(`Row ${rowNum}: Invalid amount "${cols[idx['Amount (EUR)']]}".`);
      continue;
    }

    const startDateRaw = (cols[idx['Start Date']] || '').trim();
    const startDate = startDateRaw || todayISO();

    const endDateRaw = (cols[idx['End Date']] || '').trim();
    const endDate = endDateRaw || null;

    const notes = (cols[idx['Notes']] || '').trim() || null;

    rows.push({
      id:        uuidv4(),
      name,
      category,
      frequency,
      amount,
      startDate,
      endDate,
      notes,
      createdAt: now,
      updatedAt: now,
    });
  }

  return { rows, errors, total: rows.length };
}
