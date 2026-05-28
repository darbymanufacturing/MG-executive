import { describe, test, expect } from 'vitest';
import {
  annualizedRevenue,
  annualInvestmentCost,
  calcEBITDA,
  calcBreakEvenRevenue,
  getHealthColor,
} from '../financialHealth.js';

const FIN_DEFAULTS = {
  applyFranchiseFee: true,
  franchiseRate: 0.19,
  vatRate: 0.24,
  monthlySimCost: 150,
};

describe('annualizedRevenue', () => {
  test('returns 0 for empty input', () => {
    expect(annualizedRevenue([])).toBe(0);
  });

  test('scales partial-year data by 12 / spanMonths', () => {
    // 6 months × 1000 = 6000 gross → 12000 annualized
    const rows = Array.from({ length: 6 }, (_, i) => ({
      date: `2026-0${i + 1}-15`,
      totalPaidRevenue: 1000,
    }));
    expect(annualizedRevenue(rows)).toBeCloseTo(12000);
  });

  test('applies financial adjustments when provided', () => {
    // gross annual = 12000; × 0.81 = 9720; − (150 × 12) = 7920
    const rows = Array.from({ length: 6 }, (_, i) => ({
      date: `2026-0${i + 1}-15`,
      totalPaidRevenue: 1000,
    }));
    expect(annualizedRevenue(rows, FIN_DEFAULTS)).toBeCloseTo(7920);
  });

  test('respects applyFranchiseFee=false', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      date: `2026-0${i + 1}-15`,
      totalPaidRevenue: 1000,
    }));
    // gross 12000 − (150 × 12) = 12000 − 1800 = 10200
    expect(annualizedRevenue(rows, { ...FIN_DEFAULTS, applyFranchiseFee: false }))
      .toBeCloseTo(10200);
  });
});

describe('annualInvestmentCost', () => {
  test('returns 0 when no investment-category costs', () => {
    const costs = [
      { name: 'Internet', amount: 50, category: 'tech', frequency: 'monthly', startDate: '2026-01-01' },
    ];
    expect(annualInvestmentCost(costs)).toBe(0);
  });

  test('sums only investment-category costs annualized', () => {
    const costs = [
      { name: 'Scooter fleet', amount: 5000, category: 'investment', frequency: 'one-time', startDate: '2026-01-01' },
      { name: 'Internet', amount: 50, category: 'tech', frequency: 'monthly', startDate: '2026-01-01' },
    ];
    // one-time investments contribute their full amount as the annual cost
    expect(annualInvestmentCost(costs)).toBeGreaterThan(0);
  });
});

describe('calcEBITDA', () => {
  test('returns null/null when no revenue', () => {
    const result = calcEBITDA([], []);
    expect(result.ebitda).toBeNull();
    expect(result.ebitdaMargin).toBeNull();
  });

  test('computes positive EBITDA when revenue exceeds ops cost', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      date: `2026-0${i + 1}-15`,
      totalPaidRevenue: 1000,
    }));
    // Annualized = 12000 (no financial)
    const costs = [
      { name: 'Internet', amount: 100, category: 'tech', frequency: 'monthly', startDate: '2026-01-01' },
    ];
    const result = calcEBITDA(costs, rows);
    expect(result.ebitda).toBeGreaterThan(0);
    expect(result.ebitdaMargin).toBeGreaterThan(0);
    expect(result.ebitdaMargin).toBeLessThan(100);
  });
});

describe('calcBreakEvenRevenue', () => {
  test('returns total monthly cost (excluding zero)', () => {
    const costs = [
      { name: 'A', amount: 100, category: 'tech', frequency: 'monthly', startDate: '2026-01-01' },
      { name: 'B', amount: 50, category: 'tech', frequency: 'monthly', startDate: '2026-01-01' },
    ];
    expect(calcBreakEvenRevenue(costs)).toBeGreaterThan(0);
  });
});

describe('getHealthColor — traffic-light thresholds', () => {
  test('ebitdaMargin: green ≥20, amber ≥0, red < 0', () => {
    expect(getHealthColor('ebitdaMargin', 25)).toBe('green');
    expect(getHealthColor('ebitdaMargin', 20)).toBe('green');
    expect(getHealthColor('ebitdaMargin', 10)).toBe('amber');
    expect(getHealthColor('ebitdaMargin', 0)).toBe('amber');
    expect(getHealthColor('ebitdaMargin', -5)).toBe('red');
  });

  test('roi: green ≥15, amber ≥0, red < 0', () => {
    expect(getHealthColor('roi', 20)).toBe('green');
    expect(getHealthColor('roi', 5)).toBe('amber');
    expect(getHealthColor('roi', -1)).toBe('red');
  });

  test('dscr: green ≥1.25, amber ≥1.0, red < 1.0', () => {
    expect(getHealthColor('dscr', 1.5)).toBe('green');
    expect(getHealthColor('dscr', 1.1)).toBe('amber');
    expect(getHealthColor('dscr', 0.8)).toBe('red');
  });

  test('paybackMonths uses inverted thresholds (lower is better)', () => {
    expect(getHealthColor('paybackMonths', 12)).toBe('green'); // ≤ 24
    expect(getHealthColor('paybackMonths', 24)).toBe('green');
    expect(getHealthColor('paybackMonths', 36)).toBe('amber'); // ≤ 48
    expect(getHealthColor('paybackMonths', 72)).toBe('red');
  });

  test('costRecovery: green ≥1.0, amber ≥0.8, red < 0.8', () => {
    expect(getHealthColor('costRecovery', 1.2)).toBe('green');
    expect(getHealthColor('costRecovery', 0.9)).toBe('amber');
    expect(getHealthColor('costRecovery', 0.5)).toBe('red');
  });

  test('returns muted for null/undefined/non-finite values', () => {
    expect(getHealthColor('ebitdaMargin', null)).toBe('muted');
    expect(getHealthColor('ebitdaMargin', undefined)).toBe('muted');
    expect(getHealthColor('ebitdaMargin', Infinity)).toBe('muted');
    expect(getHealthColor('ebitdaMargin', -Infinity)).toBe('muted');
    expect(getHealthColor('ebitdaMargin', NaN)).toBe('muted');
  });

  test('returns muted for unknown metric', () => {
    expect(getHealthColor('unknownMetric', 100)).toBe('muted');
  });
});
