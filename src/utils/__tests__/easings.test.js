import { describe, test, expect } from 'vitest';
import {
  linear,
  easeInQuad,
  easeOutQuad,
  easeInCubic,
  easeOutCubic,
  easeInQuart,
  easeOutQuart,
  clamp,
  lerp,
} from '../easings.js';

describe('easing functions — boundary correctness', () => {
  const ALL = { linear, easeInQuad, easeOutQuad, easeInCubic, easeOutCubic, easeInQuart, easeOutQuart };

  test.each(Object.entries(ALL))('%s returns 0 at t=0', (_name, fn) => {
    expect(fn(0)).toBeCloseTo(0, 6);
  });

  test.each(Object.entries(ALL))('%s returns 1 at t=1', (_name, fn) => {
    expect(fn(1)).toBeCloseTo(1, 6);
  });

  test.each(Object.entries(ALL))('%s is monotonic on [0, 1]', (_name, fn) => {
    let prev = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const v = fn(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
});

describe('easing functions — specific curve shape', () => {
  test('linear midpoint is 0.5', () => {
    expect(linear(0.5)).toBeCloseTo(0.5);
  });

  test('easeInQuad(0.5) < 0.5 (slow start)', () => {
    expect(easeInQuad(0.5)).toBeLessThan(0.5);
    expect(easeInQuad(0.5)).toBeCloseTo(0.25);
  });

  test('easeOutQuad(0.5) > 0.5 (fast start, slow end)', () => {
    expect(easeOutQuad(0.5)).toBeGreaterThan(0.5);
    expect(easeOutQuad(0.5)).toBeCloseTo(0.75);
  });

  test('easeOutCubic(0.5) is approximately 0.875', () => {
    // 1 - (1-0.5)^3 = 1 - 0.125 = 0.875
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875);
  });

  test('easeInQuart(0.5) is approximately 0.0625', () => {
    expect(easeInQuart(0.5)).toBeCloseTo(0.0625);
  });
});

describe('clamp', () => {
  test('clamps below min', () => { expect(clamp(-5, 0, 10)).toBe(0); });
  test('clamps above max', () => { expect(clamp(15, 0, 10)).toBe(10); });
  test('passes through values in range', () => { expect(clamp(5, 0, 10)).toBe(5); });
  test('boundary inclusive', () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

describe('lerp', () => {
  test('linear interpolation midpoint', () => {
    expect(lerp(0.5, 0, 1, 100, 200)).toBe(150);
  });

  test('clamps before fromT', () => {
    expect(lerp(-99, 0, 1, 100, 200)).toBe(100);
  });

  test('clamps after toT', () => {
    expect(lerp(99, 0, 1, 100, 200)).toBe(200);
  });

  test('applies custom ease at midpoint', () => {
    // easeInQuad(0.5) = 0.25 → 100 + 0.25*100 = 125
    expect(lerp(0.5, 0, 1, 100, 200, easeInQuad)).toBeCloseTo(125);
  });

  test('handles negative ranges', () => {
    expect(lerp(0.5, 0, 1, 0, -100)).toBe(-50);
  });

  test('handles non-unit input ranges', () => {
    // At t=2, halfway from 1 to 3, lerp from 0 to 100 = 50
    expect(lerp(2, 1, 3, 0, 100)).toBe(50);
  });

  test('returns toV when fromT === toT (avoids division by zero)', () => {
    expect(lerp(5, 1, 1, 10, 20)).toBe(20);
  });
});
