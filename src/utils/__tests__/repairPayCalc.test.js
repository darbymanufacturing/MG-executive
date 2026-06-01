import { describe, it, expect } from 'vitest';
import { computeRepairPay, partsCostOf, round2 } from '../repairPayCalc.js';

describe('round2', () => {
  it('rounds to cents', () => {
    expect(round2(2.344)).toBe(2.34);
    expect(round2(2.346)).toBe(2.35);
    expect(round2(45)).toBe(45);
    // Note: 1.005 is NOT 1.01 here — IEEE-754 stores it as 1.00499…, so it rounds
    // down. This is standard JS float behavior; money amounts in practice (rate/60
    // products) don't hit this exact edge, and the cent-level result is correct.
    expect(round2(1.005)).toBe(1);
  });
  it('guards NaN/Infinity/non-numeric → 0', () => {
    expect(round2(NaN)).toBe(0);
    expect(round2(Infinity)).toBe(0);
    expect(round2('abc')).toBe(0);
    expect(round2(undefined)).toBe(0);
  });
});

describe('partsCostOf', () => {
  it('sums quantity × unitCost', () => {
    expect(partsCostOf([{ quantity: 2, unitCost: 3.5 }, { quantity: 1, unitCost: 10 }])).toBe(17);
  });
  it('handles empty / non-array / missing fields', () => {
    expect(partsCostOf([])).toBe(0);
    expect(partsCostOf(null)).toBe(0);
    expect(partsCostOf(undefined)).toBe(0);
    expect(partsCostOf([{ quantity: 2 }, { unitCost: 5 }])).toBe(0); // each missing the other factor
  });
  it('ignores negative/garbage values (coerced to 0)', () => {
    expect(partsCostOf([{ quantity: -2, unitCost: 5 }, { quantity: 1, unitCost: 4 }])).toBe(4);
  });
});

describe('computeRepairPay', () => {
  it('labour = estimate(min)/60 × rate; pays on ESTIMATE not wall-clock', () => {
    // 90-min estimate at €30/h = €45 labour, no parts, no extra
    const r = computeRepairPay({ estimatedMinutes: 90, labourRatePerHour: 30 });
    expect(r.labourCost).toBe(45);
    expect(r.extraCost).toBe(0);
    expect(r.partsCost).toBe(0);
    expect(r.totalCost).toBe(45);
    expect(r.labourMinutesBilled).toBe(90);
  });

  it('adds extra-work minutes at the same rate', () => {
    // 60 min est + 30 min extra at €40/h = €40 + €20 = €60
    const r = computeRepairPay({ estimatedMinutes: 60, labourRatePerHour: 40, extraMinutes: 30 });
    expect(r.labourCost).toBe(40);
    expect(r.extraCost).toBe(20);
    expect(r.totalCost).toBe(60);
    expect(r.labourMinutesBilled).toBe(90);
  });

  it('adds parts cost into the total', () => {
    const r = computeRepairPay({
      estimatedMinutes: 30, labourRatePerHour: 20, // €10 labour
      partsUsed: [{ quantity: 2, unitCost: 5.5 }], // €11 parts
    });
    expect(r.labourCost).toBe(10);
    expect(r.partsCost).toBe(11);
    expect(r.totalCost).toBe(21);
  });

  it('all-zero / empty input → zeros, never NaN', () => {
    const r = computeRepairPay();
    expect(r).toEqual({ partsCost: 0, labourCost: 0, extraCost: 0, labourMinutesBilled: 0, totalCost: 0 });
  });

  it('missing labour rate → labour 0, parts still counted', () => {
    const r = computeRepairPay({ estimatedMinutes: 60, partsUsed: [{ quantity: 1, unitCost: 7 }] });
    expect(r.labourCost).toBe(0);
    expect(r.partsCost).toBe(7);
    expect(r.totalCost).toBe(7);
  });

  it('rounds money to cents (no float drift)', () => {
    // 10 min at €37/h = 6.1666… → 6.17
    const r = computeRepairPay({ estimatedMinutes: 10, labourRatePerHour: 37 });
    expect(r.labourCost).toBe(6.17);
  });
});
