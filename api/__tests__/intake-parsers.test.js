/**
 * api/__tests__/intake-parsers.test.js
 *
 * The two source parsers that decide what reaches the books automatically:
 *   walletRecordToIntake / walletCashPosition — Wallet bank records → intake raws + cash
 *   parseMyDataInvoices                        — AADE myDATA RequestDocs XML → intake raws
 *
 * Fixtures follow the VENDORS' real contracts, not our assumptions (#703/#704:
 * the first fixtures mirrored what the code expected, so the tests passed while
 * both feeds imported nothing):
 *   - Wallet: the live OpenAPI spec (GET https://rest.budgetbakers.com/wallet/openapi)
 *     Record { id, accountId, amount:{value,currencyCode}, counterParty,
 *              category:{id,name}, recordDate, recordType, transfer, note }
 *   - myDATA: RequestDocs → RequestedDoc / invoicesDoc / invoice (AADE v1.0.x)
 *
 * The rules under test protect the numbers: transfers and income must never
 * become costs, cancelled invoices and credit notes must never be spend, and
 * personal accounts must never leak in.
 *
 * Run with:  npx vitest run api/__tests__/intake-parsers.test.js
 */
import { describe, it, expect } from 'vitest';
import { walletRecordToIntake, walletAmountEUR, walletCashPosition } from '../_intake-wallet.js';
import { parseMyDataInvoices, tagValue, tagBlocks, ddmmyyyy } from '../_intake-mydata.js';
import { backfillFrom } from '../_lib/intake-store.js';

const NO_FILTER = new Set();

/** A Wallet Record exactly as GET /v1/api/records returns it. */
const walletRecord = (over = {}) => ({
  id: 'rec_1',
  accountId: 'acc_business',
  accountName: 'Alpha Business',
  accountIsBankSync: true,
  amount: { value: -40, currencyCode: 'EUR' },
  category: { id: 'cat_sw', name: 'SW subscriptions, Telco charges', color: '#123456' },
  counterParty: 'Starlink',
  note: 'Corinth site',
  recordDate: '2026-09-20T09:12:00Z',
  recordState: 'cleared',
  recordType: 'expense',
  transfer: null,
  labels: [],
  ...over,
});

describe('walletRecordToIntake — real Wallet records', () => {
  it('maps an expense: counterParty is the payee, amount.value the money', () => {
    const raw = walletRecordToIntake(walletRecord(), NO_FILTER);
    expect(raw.kind).toBe('cost');
    expect(raw.sourceRef).toBe('rec_1');
    expect(raw.payload.amount).toBe(40);           // absolute value of a negative expense
    expect(raw.payload.name).toBe('Starlink');
    expect(raw.payload.category).toBe('SW subscriptions, Telco charges');
    expect(raw.payload.date).toBe('2026-09-20T09:12:00Z');
    expect(raw.evidence.accountName).toBe('Alpha Business');
  });

  it('falls back to the note when there is no counterparty', () => {
    const raw = walletRecordToIntake(walletRecord({ counterParty: '', note: 'ΔΕΗ λογαριασμός' }), NO_FILTER);
    expect(raw.payload.name).toBe('ΔΕΗ λογαριασμός');
  });

  it("ignores transfers between the owner's own accounts (transfer object, not a flag)", () => {
    const rec = walletRecord({ transfer: { type: 'paired', transferId: 't1', mirrorRecord: { id: 'rec_2' } } });
    expect(walletRecordToIntake(rec, NO_FILTER)).toBeNull();
  });

  it('ignores income — revenue belongs to the Hopp/Stripe pipeline', () => {
    const rec = walletRecord({ amount: { value: 1200, currencyCode: 'EUR' }, recordType: 'income', counterParty: 'Hopp' });
    expect(walletRecordToIntake(rec, NO_FILTER)).toBeNull();
  });

  it('honours the company-account allowlist and fails CLOSED on a record without an account', () => {
    const allow = new Set(['acc_business']);
    expect(walletRecordToIntake(walletRecord({ accountId: 'acc_personal' }), allow)).toBeNull();
    expect(walletRecordToIntake(walletRecord({ accountId: undefined }), allow)).toBeNull();
    expect(walletRecordToIntake(walletRecord(), allow)).not.toBeNull();
  });

  it('uses the EUR conversion for a foreign-currency record, and skips one that cannot be converted', () => {
    const usd = walletRecord({
      amount: { value: -50, currencyCode: 'USD' },
      convertedAmount: { value: -46.1, currencyCode: 'EUR', ratio: 0.922, conversionPair: 'USD:EUR' },
    });
    expect(walletRecordToIntake(usd, NO_FILTER).payload.amount).toBe(46.1);
    const broken = walletRecord({ amount: { value: -50, currencyCode: 'USD' }, convertedAmount: { currencyCode: 'EUR', error: 'no rate' } });
    expect(walletRecordToIntake(broken, NO_FILTER)).toBeNull();
  });

  it('skips zero-amount and malformed records', () => {
    expect(walletRecordToIntake(walletRecord({ amount: { value: 0, currencyCode: 'EUR' } }), NO_FILTER)).toBeNull();
    expect(walletRecordToIntake(null, NO_FILTER)).toBeNull();
    expect(walletRecordToIntake({ id: 'x', amount: -40 }, NO_FILTER)).toBeNull(); // not the API's shape
  });

  it('reads amounts only from the documented object shape', () => {
    expect(walletAmountEUR(walletRecord())).toBe(-40);
    expect(walletAmountEUR({ amount: -40 })).toBeNaN();
  });
});

describe('walletCashPosition — the real bank balance and the 1 January opening', () => {
  const now = new Date('2026-09-22T06:00:00Z');
  const accounts = [
    { id: 'acc_business', name: 'Alpha Business', accountType: 'CurrentAccount', archived: false, currencyCode: 'EUR', balance: { currentBalance: 8200 } },
    { id: 'acc_savings', name: 'Savings', accountType: 'SavingAccount', archived: false, currencyCode: 'EUR', balance: { currentBalance: 1800 } },
    { id: 'acc_card', name: 'Business Visa', accountType: 'CreditCard', archived: false, currencyCode: 'EUR', balance: { currentBalance: -640 } },
    { id: 'acc_old', name: 'Closed', accountType: 'CurrentAccount', archived: true, currencyCode: 'EUR', balance: { currentBalance: 999 } },
    { id: 'acc_personal', name: 'Personal', accountType: 'CurrentAccount', archived: false, currencyCode: 'EUR', balance: { currentBalance: 5000 } },
  ];
  const records = [
    walletRecord({ id: 'r1', accountId: 'acc_business', amount: { value: 3000, currencyCode: 'EUR' }, recordDate: '2026-03-10' }),
    walletRecord({ id: 'r2', accountId: 'acc_business', amount: { value: -1000, currencyCode: 'EUR' }, recordDate: '2026-05-10' }),
    // own-account move business → savings: both legs counted, nets to zero
    walletRecord({ id: 'r3', accountId: 'acc_business', amount: { value: -500, currencyCode: 'EUR' }, recordDate: '2026-06-01', transfer: { type: 'paired' } }),
    walletRecord({ id: 'r4', accountId: 'acc_savings', amount: { value: 500, currencyCode: 'EUR' }, recordDate: '2026-06-01', transfer: { type: 'paired' } }),
    // last year — outside the YTD window
    walletRecord({ id: 'r5', accountId: 'acc_business', amount: { value: -9999, currencyCode: 'EUR' }, recordDate: '2025-12-30' }),
  ];

  it('sums only allowed, active cash accounts and back-solves the opening balance', () => {
    const cash = walletCashPosition(accounts, records, { allowedAccounts: new Set(['acc_business', 'acc_savings', 'acc_card']), now });
    expect(cash.balance).toBe(10000);                    // 8200 + 1800 (card is debt, archived + personal excluded)
    expect(cash.yearOpening.netFlowYTD).toBe(2000);      // +3000 −1000 −500 +500
    expect(cash.yearOpening.amount).toBe(8000);          // 10000 − 2000
    expect(cash.yearOpening.year).toBe(2026);
    expect(cash.cards).toEqual([{ id: 'acc_card', name: 'Business Visa', type: 'CreditCard', balance: -640 }]);
  });

  it('with no allowlist, every active account counts (the owner chose not to restrict)', () => {
    const cash = walletCashPosition(accounts, [], { now });
    expect(cash.balance).toBe(15000); // 8200 + 1800 + 5000
  });
});

describe('backfillFrom — only an admin can back-fill, and only so far', () => {
  const now = new Date('2026-09-22T06:00:00Z');
  it('accepts a manual ?from and clamps it to ~2 years', () => {
    expect(backfillFrom({ from: '2026-01-01' }, { trigger: 'manual' }, now)).toBe('2026-01-01');
    expect(backfillFrom({ from: '2019-01-01' }, { trigger: 'manual' }, now)).toBe('2024-07-14'); // now − 800 days
  });
  it('ignores it on a cron run, when malformed, or in the future', () => {
    expect(backfillFrom({ from: '2026-01-01' }, { trigger: 'cron' }, now)).toBeNull();
    expect(backfillFrom({ from: 'January' }, { trigger: 'manual' }, now)).toBeNull();
    expect(backfillFrom({ from: '2027-01-01' }, { trigger: 'manual' }, now)).toBeNull();
  });
});

/* A RequestDocs response shaped like AADE's: default namespace on the root,
 * a continuation token, the invoicesDoc wrapper, invoiceHeader/invoiceSummary
 * siblings whose names START with "invoice", one credit note, one cancellation. */
const REQUEST_DOCS_XML = `<?xml version="1.0" encoding="utf-8"?>
<RequestedDoc xmlns="http://www.aade.gr/myDATA/invoice/v1.0" xmlns:icls="https://www.aade.gr/myDATA/incomeClassificaton/v1.0">
  <continuationToken><nextPartitionKey>P2</nextPartitionKey><nextRowKey>R2</nextRowKey></continuationToken>
  <invoicesDoc>
    <invoice>
      <uid>AB12</uid>
      <mark>400001234567</mark>
      <issuer><vatNumber>094014201</vatNumber><country>GR</country><branch>0</branch></issuer>
      <counterpart><vatNumber>801234567</vatNumber><country>GR</country><branch>0</branch></counterpart>
      <invoiceHeader><series>Α</series><aa>1043</aa><issueDate>2026-09-18</issueDate><invoiceType>1.1</invoiceType><currency>EUR</currency></invoiceHeader>
      <invoiceDetails><lineNumber>1</lineNumber><netValue>100.00</netValue><vatCategory>1</vatCategory><vatAmount>24.00</vatAmount></invoiceDetails>
      <invoiceSummary><totalNetValue>100.00</totalNetValue><totalVatAmount>24.00</totalVatAmount><totalWithheldAmount>0</totalWithheldAmount><totalGrossValue>124.00</totalGrossValue></invoiceSummary>
    </invoice>
    <invoice>
      <mark>400001234568</mark>
      <issuer><vatNumber>094014201</vatNumber><country>GR</country><branch>0</branch></issuer>
      <invoiceHeader><series>Π</series><aa>77</aa><issueDate>2026-09-19</issueDate><invoiceType>5.1</invoiceType></invoiceHeader>
      <invoiceSummary><totalNetValue>10.00</totalNetValue><totalVatAmount>2.40</totalVatAmount><totalGrossValue>12.40</totalGrossValue></invoiceSummary>
    </invoice>
    <invoice>
      <mark>400001234569</mark>
      <issuer><vatNumber>999888777</vatNumber><country>GR</country><branch>0</branch></issuer>
      <invoiceHeader><series>Β</series><aa>5</aa><issueDate>2026-09-19</issueDate><invoiceType>1.1</invoiceType></invoiceHeader>
      <invoiceSummary><totalNetValue>50.00</totalNetValue><totalVatAmount>12.00</totalVatAmount><totalGrossValue>62.00</totalGrossValue></invoiceSummary>
    </invoice>
    <invoice>
      <mark>400001234570</mark>
      <issuer><vatNumber>IE6388047V</vatNumber><country>IE</country><branch>0</branch><name>Google Ireland Ltd</name></issuer>
      <invoiceHeader><series>G</series><aa>9</aa><issueDate>2026-09-20</issueDate><invoiceType>1.3</invoiceType></invoiceHeader>
      <invoiceSummary><totalNetValue>20.00</totalNetValue><totalVatAmount>0</totalVatAmount><totalGrossValue>20.00</totalGrossValue></invoiceSummary>
    </invoice>
  </invoicesDoc>
  <cancelledInvoicesDoc>
    <cancelledInvoice><invoiceMark>400001234569</invoiceMark><cancellationMark>400001239999</cancellationMark><cancellationDate>2026-09-20</cancellationDate></cancelledInvoice>
  </cancelledInvoicesDoc>
</RequestedDoc>`;

describe('parseMyDataInvoices — RequestDocs', () => {
  const items = parseMyDataInvoices(REQUEST_DOCS_XML);

  it('extracts each purchase invoice with its MARK, date and VAT split', () => {
    const inv = items.find((i) => i.sourceRef === '400001234567');
    expect(inv.payload.amount).toBe(124);
    expect(inv.payload.vatAmount).toBe(24);
    expect(inv.payload.date).toBe('2026-09-18');
    expect(inv.payload.counterpartVat).toBe('094014201');      // the ISSUER, not us (counterpart)
    expect(inv.payload.name).toBe('ΑΦΜ 094014201');
    expect(inv.payload.notes).toContain('Α/1043');
    expect(inv.evidence.mydataMark).toBe('400001234567');
  });

  it('drops credit notes (5.x) and invoices the issuer cancelled', () => {
    expect(items.map((i) => i.sourceRef).sort()).toEqual(['400001234567', '400001234570']);
  });

  it("uses a foreign issuer's transmitted name", () => {
    expect(items.find((i) => i.sourceRef === '400001234570').payload.name).toBe('Google Ireland Ltd');
  });

  it('matches whole tag names only — <invoice> never matches <invoiceHeader>/<invoicesDoc>', () => {
    const xml = '<invoicesDoc><invoiceHeader><x>1</x></invoiceHeader><invoice><mark>7</mark></invoice></invoicesDoc>';
    expect(tagBlocks(xml, 'invoice')).toEqual(['<mark>7</mark>']);
  });

  it('reads the continuation token and is safe on junk input', () => {
    expect(tagValue(REQUEST_DOCS_XML, 'nextPartitionKey')).toBe('P2');
    expect(parseMyDataInvoices('not xml at all')).toEqual([]);
    expect(parseMyDataInvoices(null)).toEqual([]);
  });

  it('formats dates the only way myDATA accepts', () => {
    expect(ddmmyyyy(new Date('2026-09-05T00:00:00Z'))).toBe('05/09/2026');
  });
});
