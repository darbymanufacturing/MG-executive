/**
 * api/__tests__/intake-parsers.test.js
 *
 * The two source parsers that decide what reaches the books automatically:
 *   walletRecordToIntake  — Wallet bank record → intake raw
 *   parseMyDataInvoices   — AADE myDATA XML → intake raws
 *
 * The rules under test are the ones that protect the numbers: transfers and
 * income must never become costs (double-counting), and credit notes must never
 * be imported as spend.
 *
 * Run with:  npx vitest run api/__tests__/intake-parsers.test.js
 */
import { describe, it, expect } from 'vitest';
import { walletRecordToIntake } from '../_intake-wallet.js';
import { parseMyDataInvoices, tagValue } from '../_intake-mydata.js';

const NO_FILTER = new Set();

describe('walletRecordToIntake', () => {
  it('maps an expense into an intake raw', () => {
    const raw = walletRecordToIntake({
      id: 'rec_1',
      amount: -40,
      currency: 'EUR',
      recordDate: '2026-09-20',
      payee: 'Starlink',
      category: { name: 'SW subscriptions, Telco charges' },
      note: 'Corinth site',
      account: { id: 'acc_business' },
    }, NO_FILTER);

    expect(raw.kind).toBe('cost');
    expect(raw.sourceRef).toBe('rec_1');
    expect(raw.payload.amount).toBe(40);           // absolute value
    expect(raw.payload.name).toBe('Starlink');
    expect(raw.payload.category).toBe('SW subscriptions, Telco charges');
  });

  it('ignores transfers between the owner\'s own accounts', () => {
    expect(walletRecordToIntake({ id: 'r', amount: -500, transfer: true, recordDate: '2026-09-20' }, NO_FILTER)).toBeNull();
    expect(walletRecordToIntake({ id: 'r', amount: -500, type: 'transfer', recordDate: '2026-09-20' }, NO_FILTER)).toBeNull();
  });

  it('ignores income — revenue belongs to the Hopp/Stripe pipeline', () => {
    expect(walletRecordToIntake({ id: 'r', amount: 2000, type: 'income', recordDate: '2026-09-20' }, NO_FILTER)).toBeNull();
    expect(walletRecordToIntake({ id: 'r', amount: 2000, recordDate: '2026-09-20' }, NO_FILTER)).toBeNull();
  });

  it('honours the company-account allowlist (privacy: personal accounts stay out)', () => {
    const rec = { id: 'r', amount: -12, recordDate: '2026-09-20', payee: 'Shop', account: { id: 'personal_1' } };
    expect(walletRecordToIntake(rec, new Set(['acc_business']))).toBeNull();
    expect(walletRecordToIntake({ ...rec, account: { id: 'acc_business' } }, new Set(['acc_business']))).not.toBeNull();
  });

  it('skips zero-amount and malformed records', () => {
    expect(walletRecordToIntake({ id: 'r', amount: 0 }, NO_FILTER)).toBeNull();
    expect(walletRecordToIntake(null, NO_FILTER)).toBeNull();
  });
});

describe('parseMyDataInvoices', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<RequestedDoc xmlns="http://www.aade.gr/myDATA/invoice/v1.0">
  <invoicesDoc>
    <invoice>
      <mark>400001234567890</mark>
      <issuer><vatNumber>094014201</vatNumber><country>GR</country></issuer>
      <invoiceHeader><series>A</series><aa>151</aa><issueDate>2026-09-18</issueDate><invoiceType>1.1</invoiceType></invoiceHeader>
      <invoiceSummary><totalNetValue>100.00</totalNetValue><totalVatAmount>24.00</totalVatAmount><totalGrossValue>124.00</totalGrossValue></invoiceSummary>
    </invoice>
    <invoice>
      <mark>400001234567891</mark>
      <issuer><vatNumber>999888777</vatNumber></issuer>
      <invoiceHeader><issueDate>2026-09-19</issueDate><invoiceType>5.1</invoiceType></invoiceHeader>
      <invoiceSummary><totalNetValue>50.00</totalNetValue><totalVatAmount>12.00</totalVatAmount><totalGrossValue>62.00</totalGrossValue></invoiceSummary>
    </invoice>
  </invoicesDoc>
</RequestedDoc>`;

  const items = parseMyDataInvoices(xml);

  it('extracts the purchase invoice with its VAT split', () => {
    expect(items).toHaveLength(1);
    const [inv] = items;
    expect(inv.sourceRef).toBe('400001234567890');
    expect(inv.payload.amount).toBe(124);
    expect(inv.payload.vatAmount).toBe(24);
    expect(inv.payload.date).toBe('2026-09-18');
    expect(inv.payload.counterpartVat).toBe('094014201');
    expect(inv.evidence.mydataMark).toBe('400001234567890');
  });

  it('drops credit notes (5.x) — they reduce a cost, they are not spend', () => {
    expect(items.find((i) => i.sourceRef === '400001234567891')).toBeUndefined();
  });

  it('is namespace-agnostic and safe on junk input', () => {
    expect(parseMyDataInvoices('')).toEqual([]);
    expect(parseMyDataInvoices('<nope/>')).toEqual([]);
    expect(parseMyDataInvoices(null)).toEqual([]);
  });

  it('tagValue reads a single tag', () => {
    expect(tagValue('<a><b>42</b></a>', 'b')).toBe('42');
    expect(tagValue('<a></a>', 'b')).toBeNull();
  });
});
