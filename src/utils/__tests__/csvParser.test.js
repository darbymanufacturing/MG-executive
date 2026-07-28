/**
 * parseRevenueCSV — regression tests for bug #683.
 *
 * Hopp's trip-analytics export gained a "Total reserved trip minutes" column
 * (7th, between "Penalty trips" and "Total ride trip minutes"), taking the file
 * from 25 to 26 columns. The old width check compared each row against the
 * hardcoded EXPECTED_HEADERS length, so every single row of a valid new-format
 * export was reported as malformed ("has 26 columns but expected 25") and the
 * import panel mislabelled those warnings as "N skipped" — even though nothing
 * was skipped and the data mapped correctly (mapping is by header NAME).
 *
 * These tests lock in that BOTH widths import cleanly, that a genuinely
 * malformed row is still caught, and that `skipped` counts only rows actually
 * dropped.
 */
import { describe, test, expect } from 'vitest';
import { parseRevenueCSV } from '../csvParser.js';

const COLS_25 = [
  'Date', 'VAT rate', 'Currency', 'Total trips', 'Free trips', 'Penalty trips',
  'Total ride trip minutes', 'Total paused trip minutes', 'Total trip distance (km)',
  'Unique users count', 'Unique vehicles count', 'Total raw income',
  'Total free trip worth', 'Total raw refunds', 'Total vat', 'Refunded vat',
  'Unpaid user revenue', 'User debt refunds', 'Unpaid org revenue', 'Org debt refunds',
  'Total paid debt', 'Average payment', 'Average worth', 'Total paid revenue',
  'Total paid refunds',
];

// The current Hopp export: same columns, plus the reserved-minutes column at index 6.
const COLS_26 = [
  ...COLS_25.slice(0, 6), 'Total reserved trip minutes', ...COLS_25.slice(6),
];

const quote = (vals) => vals.map((v) => `"${v}"`).join(',');

// A real row from a live export (14 Jun 2026), in 26-column order.
const ROW_26 = [
  '14 Jun 2026', '0.24', 'EUR', '33', '1', '0', '2', '653', '16', '77', '16', '14',
  '171.90', '1.03', '0.00', '41.26', '0.00', '9.76', '0.00', '0.00', '0.00', '3.74',
  '5.03', '5.21', '165.89', '0.00',
];
// The same day in the older 25-column shape (reserved-minutes column removed).
const ROW_25 = [...ROW_26.slice(0, 6), ...ROW_26.slice(7)];

describe('parseRevenueCSV — Hopp export width (#683)', () => {
  test('parses the current 26-column export with no width warnings', () => {
    const csv = `${quote(COLS_26)}\n${quote(ROW_26)}`;
    const { rows, errors, total, skipped } = parseRevenueCSV(csv);

    expect(errors).toEqual([]);
    expect(total).toBe(1);
    expect(skipped).toBe(0);
    expect(rows[0].date).toBe('2026-06-14');
    expect(rows[0].totalReservedTripMinutes).toBe(2);
    // Fields AFTER the inserted column must not be shifted.
    expect(rows[0].totalRideTripMinutes).toBe(653);
    expect(rows[0].totalTripDistanceKm).toBe(77);
    expect(rows[0].totalRawIncome).toBe(171.9);
    expect(rows[0].totalPaidRevenue).toBe(165.89);
  });

  test('still parses the legacy 25-column export; the absent column reads 0', () => {
    const csv = `${quote(COLS_25)}\n${quote(ROW_25)}`;
    const { rows, errors, total, skipped } = parseRevenueCSV(csv);

    expect(errors).toEqual([]);
    expect(total).toBe(1);
    expect(skipped).toBe(0);
    expect(rows[0].totalReservedTripMinutes).toBe(0);
    expect(rows[0].totalRideTripMinutes).toBe(653);
    expect(rows[0].totalPaidRevenue).toBe(165.89);
  });

  test('a row wider than its own header is still reported (the #76 guard survives)', () => {
    const csv = `${quote(COLS_26)}\n${quote([...ROW_26, 'stray'])}`;
    const { errors, total, skipped } = parseRevenueCSV(csv);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('27 columns');
    // The row is still imported — a stray trailing comma does not drop the day.
    expect(total).toBe(1);
    expect(skipped).toBe(0);
  });

  test('a short row (trailing field omitted) imports, defaulting the missing field to 0', () => {
    // Hopp omits the trailing "Total paid refunds" on the most recent day.
    const csv = `${quote(COLS_26)}\n${quote(ROW_26.slice(0, -1))}`;
    const { rows, errors, total, skipped } = parseRevenueCSV(csv);

    expect(errors).toEqual([]);
    expect(total).toBe(1);
    expect(skipped).toBe(0);
    expect(rows[0].totalPaidRefunds).toBe(0);
    expect(rows[0].totalPaidRevenue).toBe(165.89);
  });

  test('`skipped` counts only rows actually dropped, not width warnings', () => {
    const bad = [...ROW_26];
    bad[0] = 'not a date';
    const csv = `${quote(COLS_26)}\n${quote(ROW_26)}\n${quote(bad)}`;
    const { total, skipped, errors } = parseRevenueCSV(csv);

    expect(total).toBe(1);
    expect(skipped).toBe(1);
    expect(errors.some((e) => e.includes('Could not parse date'))).toBe(true);
  });

  test('rejects a genuinely unrecognised file by naming the missing columns', () => {
    const csv = '"Foo","Bar"\n"1","2"';
    const { rows, errors, total, skipped } = parseRevenueCSV(csv);

    expect(rows).toEqual([]);
    expect(total).toBe(0);
    expect(skipped).toBe(0);
    expect(errors[0]).toContain('Unrecognised CSV format');
  });
});

describe('parseRevenueCSV — Hopp value quirks', () => {
  test("treats the \"'-\" sentinel as 0 and strips thousands separators", () => {
    const row = [...ROW_26];
    row[7] = '1,473';   // Total ride trip minutes — thousands separator
    row[12] = "'-";     // Total raw income — Hopp's null sentinel
    const csv = `${quote(COLS_26)}\n${quote(row)}`;
    const { rows } = parseRevenueCSV(csv);

    expect(rows[0].totalRideTripMinutes).toBe(1473);
    expect(rows[0].totalRawIncome).toBe(0);
  });

  test('strips a UTF-8 BOM so Windows exports are recognised (#533)', () => {
    const BOM = String.fromCharCode(0xFEFF); // literal U+FEFF trips no-irregular-whitespace
    const csv = `${BOM}${quote(COLS_26)}\n${quote(ROW_26)}`;
    const { rows, errors } = parseRevenueCSV(csv);

    expect(errors).toEqual([]);
    expect(rows[0].date).toBe('2026-06-14');
  });
});
