import { describe, test, expect } from 'vitest';
import {
  totalRevenue,
  revenueBreakdown,
  operatingRevenue,
  applyFinancialAdjustments,
  avgTripsPerDay,
  revenuePerTrip,
  vehicleUtilization,
  monthlyRevenueSummary,
  filterByRange,
  filterRevenueByLocation,
  revenuePerCityBreakdown,
} from '../revenueCalculations.js';

const FIN_DEFAULTS = {
  applyFranchiseFee: true,
  franchiseRate: 0.19,
  vatRate: 0.24,
  monthlySimCost: 150,
};

describe('totalRevenue', () => {
  test('sums totalPaidRevenue across rows', () => {
    const rows = [
      { date: '2026-01-01', totalPaidRevenue: 100 },
      { date: '2026-01-02', totalPaidRevenue: 200 },
      { date: '2026-01-03', totalPaidRevenue: 0 },
    ];
    expect(totalRevenue(rows)).toBe(300);
  });

  test('treats missing totalPaidRevenue as zero', () => {
    const rows = [{ date: '2026-01-01' }, { date: '2026-01-02', totalPaidRevenue: 50 }];
    expect(totalRevenue(rows)).toBe(50);
  });

  test('returns 0 for empty array', () => {
    expect(totalRevenue([])).toBe(0);
  });
});

describe('revenueBreakdown — the Hopp fee + VAT + SIM identity', () => {
  test('applies all adjustments correctly with defaults', () => {
    const rows = [{ date: '2026-01-15', totalPaidRevenue: 1000 }];
    const b = revenueBreakdown(rows, FIN_DEFAULTS, 1);

    expect(b.gross).toBe(1000);
    expect(b.hoppFee).toBeCloseTo(190);          // 1000 × 0.19
    expect(b.companyShare).toBeCloseTo(810);     // 1000 - 190
    expect(b.vatPortion).toBeCloseTo(240);       // 1000 × 0.24
    expect(b.simCost).toBe(150);
    expect(b.operatingRevenue).toBeCloseTo(660); // 810 - 150
    expect(b.cashReceived).toBeCloseTo(900);     // 810 + 240 - 150
  });

  test('skips franchise fee when toggle is off', () => {
    const rows = [{ date: '2026-01-15', totalPaidRevenue: 1000 }];
    const b = revenueBreakdown(rows, { ...FIN_DEFAULTS, applyFranchiseFee: false }, 1);
    expect(b.hoppFee).toBe(0);
    expect(b.companyShare).toBe(1000);
    expect(b.operatingRevenue).toBe(850); // 1000 - 150
  });

  test('scales SIM cost by periodMonths', () => {
    const rows = [{ date: '2026-01-15', totalPaidRevenue: 12000 }];
    const b = revenueBreakdown(rows, FIN_DEFAULTS, 12);
    expect(b.simCost).toBe(1800); // 150 × 12
    // operatingRevenue = 12000 × 0.81 − 1800 = 9720 − 1800 = 7920
    expect(b.operatingRevenue).toBeCloseTo(7920);
  });

  test('handles empty revenue with defaults', () => {
    const b = revenueBreakdown([], FIN_DEFAULTS, 1);
    expect(b.gross).toBe(0);
    expect(b.hoppFee).toBe(0);
    expect(b.operatingRevenue).toBe(-150); // negative because of SIM cost
  });

  test('falls back to defaults if financial is null/undefined', () => {
    const rows = [{ date: '2026-01-15', totalPaidRevenue: 1000 }];
    const b = revenueBreakdown(rows, null, 1);
    // Defaults inside the function: franchiseFee on, rate 0.19, vat 0.24, sim 150
    expect(b.hoppFee).toBeCloseTo(190);
    expect(b.operatingRevenue).toBeCloseTo(660);
  });
});

describe('operatingRevenue', () => {
  test('matches revenueBreakdown.operatingRevenue', () => {
    const rows = [{ date: '2026-01-15', totalPaidRevenue: 1000 }];
    const op = operatingRevenue(rows, FIN_DEFAULTS, 1);
    const b = revenueBreakdown(rows, FIN_DEFAULTS, 1);
    expect(op).toBeCloseTo(b.operatingRevenue);
  });
});

describe('applyFinancialAdjustments — monthly trend post-processor', () => {
  test('adjusts revenue and profit for one month', () => {
    const trend = [{ month: 'Jan 2026', revenue: 1000, total: 500 }];
    const adjusted = applyFinancialAdjustments(trend, FIN_DEFAULTS);

    // revenue = 1000 × 0.81 − 150 = 660; profit = 660 − 500 = 160
    expect(adjusted[0].revenue).toBeCloseTo(660);
    expect(adjusted[0].profit).toBeCloseTo(160);
    expect(adjusted[0].month).toBe('Jan 2026');
    expect(adjusted[0].total).toBe(500);
  });

  test('preserves extra fields on each entry', () => {
    const trend = [{ month: 'Jan 2026', revenue: 1000, total: 500, extra: 'keep me' }];
    const adjusted = applyFinancialAdjustments(trend, FIN_DEFAULTS);
    expect(adjusted[0].extra).toBe('keep me');
  });

  test('handles missing total field as zero', () => {
    const trend = [{ month: 'Jan 2026', revenue: 1000 }];
    const adjusted = applyFinancialAdjustments(trend, FIN_DEFAULTS);
    expect(adjusted[0].profit).toBeCloseTo(660); // 660 - 0
  });
});

describe('avgTripsPerDay / revenuePerTrip', () => {
  test('avgTripsPerDay divides total trips by row count', () => {
    const rows = [
      { date: '2026-01-01', totalTrips: 10 },
      { date: '2026-01-02', totalTrips: 20 },
      { date: '2026-01-03', totalTrips: 30 },
    ];
    expect(avgTripsPerDay(rows)).toBe(20);
  });

  test('revenuePerTrip returns 0 with no trips', () => {
    const rows = [{ date: '2026-01-01', totalPaidRevenue: 100, totalTrips: 0 }];
    expect(revenuePerTrip(rows)).toBe(0);
  });

  test('revenuePerTrip divides revenue by total trips', () => {
    const rows = [
      { date: '2026-01-01', totalPaidRevenue: 100, totalTrips: 10 },
      { date: '2026-01-02', totalPaidRevenue: 200, totalTrips: 10 },
    ];
    expect(revenuePerTrip(rows)).toBe(15); // 300 / 20
  });
});

describe('vehicleUtilization', () => {
  test('returns 0 when fleet size missing', () => {
    expect(vehicleUtilization([{ uniqueVehiclesCount: 5 }], 0)).toBe(0);
  });

  test('caps utilization at 100%', () => {
    const rows = [{ uniqueVehiclesCount: 50 }];
    expect(vehicleUtilization(rows, 10)).toBe(100);
  });

  test('averages unique vehicles across rows', () => {
    const rows = [{ uniqueVehiclesCount: 5 }, { uniqueVehiclesCount: 10 }];
    expect(vehicleUtilization(rows, 20)).toBe(37.5); // avg 7.5 / 20 × 100
  });
});

describe('monthlyRevenueSummary', () => {
  test('returns 12 entries with zero for missing months', () => {
    const summary = monthlyRevenueSummary([], 2026);
    expect(summary).toHaveLength(12);
    expect(summary.every((m) => m.revenue === 0)).toBe(true);
  });

  test('groups revenue by YYYY-MM prefix', () => {
    const rows = [
      { date: '2026-01-15', totalPaidRevenue: 100, totalTrips: 10 },
      { date: '2026-01-20', totalPaidRevenue: 200, totalTrips: 20 },
      { date: '2026-03-10', totalPaidRevenue: 500, totalTrips: 50 },
    ];
    const summary = monthlyRevenueSummary(rows, 2026);
    expect(summary[0].revenue).toBe(300); // Jan
    expect(summary[2].revenue).toBe(500); // Mar
    expect(summary[1].revenue).toBe(0);   // Feb has nothing
  });
});

describe('filterByRange', () => {
  test('inclusive on both ends', () => {
    const rows = [
      { date: '2026-01-01' },
      { date: '2026-01-15' },
      { date: '2026-02-01' },
    ];
    const filtered = filterByRange(rows, '2026-01-01', '2026-01-15');
    expect(filtered).toHaveLength(2);
  });

  test('passes everything when both bounds null', () => {
    const rows = [{ date: '2026-01-01' }, { date: '2026-01-15' }];
    expect(filterByRange(rows, null, null)).toHaveLength(2);
  });
});

describe('filterRevenueByLocation', () => {
  test('returns all when filter is null', () => {
    const rows = [{ location: 'Athens' }, { location: 'Corinth' }];
    expect(filterRevenueByLocation(rows, null)).toHaveLength(2);
  });

  test('returns all when filter is "all"', () => {
    const rows = [{ location: 'Athens' }, { location: 'Corinth' }];
    expect(filterRevenueByLocation(rows, 'all')).toHaveLength(2);
  });

  test('filters to matching location only', () => {
    const rows = [{ location: 'Athens' }, { location: 'Corinth' }, { location: 'Athens' }];
    expect(filterRevenueByLocation(rows, 'Athens')).toHaveLength(2);
  });
});

describe('revenuePerCityBreakdown', () => {
  test('returns empty array when no cities provided', () => {
    expect(revenuePerCityBreakdown([], [], [])).toEqual([]);
    expect(revenuePerCityBreakdown([], [], null)).toEqual([]);
  });

  test('aggregates revenue + scooters per city and sorts by revenue', () => {
    const rev = [
      { location: 'Athens', totalPaidRevenue: 100, totalTrips: 10 },
      { location: 'Corinth', totalPaidRevenue: 500, totalTrips: 50 },
    ];
    const scooters = [
      { city: 'Athens', status: 'Active' },
      { city: 'Athens', status: 'In Repair' },
      { city: 'Corinth', status: 'Active' },
      { city: 'Corinth', status: 'Active' },
    ];
    const result = revenuePerCityBreakdown(rev, scooters, ['Athens', 'Corinth']);

    expect(result).toHaveLength(2);
    expect(result[0].city).toBe('Corinth'); // higher revenue first
    expect(result[0].activeScooters).toBe(2);
    expect(result[1].activeScooters).toBe(1);
    expect(result[1].totalScooters).toBe(2);
  });
});
