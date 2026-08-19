/**
 * parseStripeCSV — regression tests for the Stripe (XSlide) revenue importer.
 *
 * Two things a naive parser gets wrong, both locked in below:
 *   - `Amount` is the AUTHORIZED amount, not what was captured — a €3 pre-auth
 *     partially captured at €2.79 still shows Amount: 3.00. Only Converted
 *     Amount (minus Converted Amount Refunded) is real settled money.
 *   - `Created date (UTC)` must bucket into Europe/Athens calendar days, not
 *     UTC ones — a charge just before midnight Athens time still falls on the
 *     PREVIOUS UTC day.
 */
import { describe, test, expect } from 'vitest';
import { parseStripeCSV } from '../parseStripeCsv.js';

const HEADER = [
  'id', 'Created date (UTC)', 'Amount', 'Amount Refunded', 'Currency', 'Captured',
  'Converted Amount', 'Converted Amount Refunded', 'Converted Currency',
  'Decline Reason', 'Description', 'Fee', 'Refunded date (UTC)', 'Statement Descriptor',
  'Status', 'Seller Message', 'Taxes On Fee', 'Card ID', 'Customer ID',
  'Customer Description', 'Customer Email', 'Invoice ID', 'Transfer',
  'invoice_id (metadata)', 'user_id (metadata)',
];

function row({
  id = 'ch_test1', created = '2026-08-15 12:00:00', amount = '5.00', amountRefunded = '0.00',
  currency = 'eur', captured = 'true', converted = amount, convertedRefunded = amountRefunded,
  convertedCurrency = 'eur', fee = '0.33', status = 'Paid', userId = 'user_1',
} = {}) {
  return [
    id, created, amount, amountRefunded, currency, captured, converted, convertedRefunded,
    convertedCurrency, '', '', fee, '', 'XSLIDE', status, 'Payment complete.', '0.00',
    'pm_test', 'cus_test', '', 'test@example.com', '', '', '', userId,
  ].join(',');
}

function csvOf(rows) {
  return [HEADER.join(','), ...rows].join('\n');
}

describe('parseStripeCSV — settled-amount correctness', () => {
  test('uses Converted Amount, never Amount — a pre-auth partially captured', () => {
    const csv = csvOf([row({ amount: '3.00', converted: '2.79', fee: '0.29' })]);
    const { rows, errors, skipped } = parseStripeCSV(csv);

    expect(errors).toEqual([]);
    expect(skipped).toBe(0);
    expect(rows[0].grossInclVat).toBe(2.79);
  });

  test('subtracts Converted Amount Refunded from Converted Amount', () => {
    const csv = csvOf([row({ amount: '5.00', converted: '5.00', convertedRefunded: '2.00' })]);
    const { rows } = parseStripeCSV(csv);

    expect(rows[0].grossInclVat).toBe(3.00);
  });
});

describe('parseStripeCSV — filtering', () => {
  test('skips non-Paid / non-captured rows and counts them as skipped', () => {
    const csv = csvOf([
      row({ id: 'ch_ok', status: 'Paid', captured: 'true' }),
      row({ id: 'ch_failed', status: 'Failed', captured: 'false' }),
    ]);
    const { rows, total, skipped } = parseStripeCSV(csv);

    expect(total).toBe(1);
    expect(skipped).toBe(1);
    expect(rows[0].chargeIds).toEqual(['ch_ok']);
  });

  test('skips a row settled in a non-EUR currency', () => {
    const csv = csvOf([row({ convertedCurrency: 'usd' })]);
    const { total, skipped, errors } = parseStripeCSV(csv);

    expect(total).toBe(0);
    expect(skipped).toBe(1);
    expect(errors[0]).toContain('unsupported currency');
  });

  test('skips a row with an unparseable timestamp', () => {
    const csv = csvOf([row({ created: 'not-a-date' })]);
    const { total, skipped, errors } = parseStripeCSV(csv);

    expect(total).toBe(0);
    expect(skipped).toBe(1);
    expect(errors[0]).toContain('could not parse date');
  });
});

describe('parseStripeCSV — Europe/Athens day bucketing', () => {
  test('buckets a late-UTC charge into the next Athens calendar day', () => {
    // 22:30 UTC + 3h (Athens summer, UTC+3) = 01:30 the next day.
    const csv = csvOf([row({ created: '2026-08-15 22:30:00' })]);
    const { rows } = parseStripeCSV(csv);

    expect(rows[0].date).toBe('2026-08-16');
  });

  test('an early-UTC charge stays on the same Athens day', () => {
    const csv = csvOf([row({ created: '2026-08-15 05:00:00' })]);
    const { rows } = parseStripeCSV(csv);

    expect(rows[0].date).toBe('2026-08-15');
  });

  test('returns days sorted ascending, independent of file order', () => {
    const csv = csvOf([
      row({ id: 'ch_1', created: '2026-08-16 09:00:00' }),
      row({ id: 'ch_2', created: '2026-08-14 09:00:00' }),
      row({ id: 'ch_3', created: '2026-08-15 09:00:00' }),
    ]);
    const { rows } = parseStripeCSV(csv);

    expect(rows.map((r) => r.date)).toEqual(['2026-08-14', '2026-08-15', '2026-08-16']);
  });
});

describe('parseStripeCSV — per-day aggregation', () => {
  test('sums charges, fees, and tracks distinct users on one Athens day', () => {
    const csv = csvOf([
      row({ id: 'ch_a', created: '2026-08-15 09:00:00', converted: '3.00', fee: '0.30', userId: 'user_1' }),
      row({ id: 'ch_b', created: '2026-08-15 10:00:00', converted: '5.00', fee: '0.33', userId: 'user_2' }),
      row({ id: 'ch_c', created: '2026-08-15 11:00:00', converted: '3.00', fee: '0.30', userId: 'user_1' }),
    ]);
    const { rows, total } = parseStripeCSV(csv);

    expect(total).toBe(1);
    expect(rows[0].chargeCount).toBe(3);
    expect(rows[0].grossInclVat).toBe(11.00);
    expect(rows[0].stripeFees).toBeCloseTo(0.93, 2);
    expect(rows[0].uniqueUsersCount).toBe(2);
    expect(rows[0].chargeIds).toEqual(['ch_a', 'ch_b', 'ch_c']);
  });
});

describe('parseStripeCSV — file-level handling', () => {
  test('rejects a genuinely unrecognised file by naming the missing columns', () => {
    const csv = 'Foo,Bar\n1,2';
    const { rows, errors, total, skipped } = parseStripeCSV(csv);

    expect(rows).toEqual([]);
    expect(total).toBe(0);
    expect(skipped).toBe(0);
    expect(errors[0]).toContain('Unrecognised CSV format');
  });

  test('rejects a file missing just one required column', () => {
    const partialHeader = HEADER.filter((h) => h !== 'user_id (metadata)');
    const csv = [partialHeader.join(','), row()].join('\n');
    const { errors, total } = parseStripeCSV(csv);

    expect(total).toBe(0);
    expect(errors[0]).toContain('user_id (metadata)');
  });

  test('strips a UTF-8 BOM so Windows exports are recognised', () => {
    const BOM = String.fromCharCode(0xFEFF);
    const csv = BOM + csvOf([row()]);
    const { rows, errors } = parseStripeCSV(csv);

    expect(errors).toEqual([]);
    expect(rows[0].date).toBe('2026-08-15');
  });

  test('an empty file returns no rows with a clear error', () => {
    const { rows, errors, total, skipped } = parseStripeCSV('');

    expect(rows).toEqual([]);
    expect(total).toBe(0);
    expect(skipped).toBe(0);
    expect(errors[0]).toContain('empty');
  });
});
