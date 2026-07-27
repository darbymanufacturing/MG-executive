import { describe, test, expect } from 'vitest';
import { vatSplit, stripVat } from '../vat.js';

describe('vatSplit', () => {
  test('splits a gross amount at the standard Greek 24% rate', () => {
    const { net, vat } = vatSplit(124, 0.24);
    expect(net).toBe(100);
    expect(vat).toBe(24);
  });

  test('net + vat reconstructs the original gross amount', () => {
    const { net, vat } = vatSplit(500, 0.24);
    expect(Math.round((net + vat) * 100) / 100).toBe(500);
  });

  test('rounds net and vat to 2 decimal places', () => {
    const { net, vat } = vatSplit(100, 0.24);
    // 100 / 1.24 = 80.6451612903... -> 80.65 ; vat = 19.35
    expect(net).toBe(80.65);
    expect(vat).toBe(19.35);
  });

  test('rate of 0 returns the gross amount as net, with zero VAT', () => {
    const { net, vat } = vatSplit(150, 0);
    expect(net).toBe(150);
    expect(vat).toBe(0);
  });

  test('negative rate is treated as invalid — gross passed through unchanged', () => {
    const { net, vat } = vatSplit(150, -0.1);
    expect(net).toBe(150);
    expect(vat).toBe(0);
  });

  test('missing/undefined rate defaults to no VAT split', () => {
    const { net, vat } = vatSplit(200, undefined);
    expect(net).toBe(200);
    expect(vat).toBe(0);
  });

  test('non-numeric rate (NaN / string) is treated as invalid', () => {
    expect(vatSplit(200, NaN)).toEqual({ net: 200, vat: 0 });
    expect(vatSplit(200, 'not-a-number')).toEqual({ net: 200, vat: 0 });
  });

  test('non-numeric gross returns zeroed result', () => {
    expect(vatSplit(undefined, 0.24)).toEqual({ net: 0, vat: 0 });
    expect(vatSplit(null, 0.24)).toEqual({ net: 0, vat: 0 });
    expect(vatSplit('oops', 0.24)).toEqual({ net: 0, vat: 0 });
  });

  test('gross of 0 returns zero net and zero vat', () => {
    expect(vatSplit(0, 0.24)).toEqual({ net: 0, vat: 0 });
  });
});

describe('stripVat', () => {
  test('returns just the net portion at 24%', () => {
    expect(stripVat(124, 0.24)).toBe(100);
  });

  test('matches vatSplit(...).net for arbitrary values', () => {
    expect(stripVat(999.99, 0.24)).toBe(vatSplit(999.99, 0.24).net);
  });

  test('invalid rate returns gross unchanged', () => {
    expect(stripVat(75, 0)).toBe(75);
    expect(stripVat(75, undefined)).toBe(75);
  });
});
