import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// Mock Firebase and all context modules so the module load succeeds without real credentials.
vi.mock('../../lib/firebase.js', () => ({ db: {}, auth: {} }));
vi.mock('../../context/CostContext.jsx', () => ({ useCosts: vi.fn() }));
vi.mock('../../context/RevenueContext.jsx', () => ({ useRevenue: vi.fn() }));
vi.mock('../../context/MaintenanceContext.jsx', () => ({ useMaintenance: vi.fn() }));
vi.mock('../../context/FleetContext.jsx', () => ({ useFleet: vi.fn() }));
vi.mock('../../context/MetricsContext.jsx', () => ({ useMetrics: vi.fn() }));
vi.mock('./PulseStrip.module.css', () => ({ default: {} }));
// lucide-react stubs — must include every icon imported by transitive deps (Toast.jsx etc.)
vi.mock('lucide-react', () => ({
  ArrowUp:       () => null,
  ArrowDown:     () => null,
  Minus:         () => null,
  CheckCircle:   () => null,
  AlertCircle:   () => null,
  Info:          () => null,
  AlertTriangle: () => null,
  X:             () => null,
}));

import { useCosts } from '../../context/CostContext.jsx';
import { useRevenue } from '../../context/RevenueContext.jsx';
import { useMaintenance } from '../../context/MaintenanceContext.jsx';
import { useFleet } from '../../context/FleetContext.jsx';
import { useMetrics } from '../../context/MetricsContext.jsx';
import PulseStrip from './PulseStrip.jsx';

beforeEach(() => {
  useRevenue.mockReturnValue({ revenueData: [] });
  useCosts.mockReturnValue({ costs: [], config: { fleetSize: 10 } });
  useMaintenance.mockReturnValue({
    tickets: [],
    scooters: [
      { id: 's1', status: 'Active' },
      { id: 's2', status: 'Active' },
      { id: 's3', status: 'In Repair' },
    ],
  });
});

/* ── BUG #354: Active fleet tile should show live count, not static config ── */
describe('PulseStrip — Active fleet tile', () => {
  test('shows live active scooter count over configured fleet size (2 / 10)', () => {
    render(<PulseStrip />);
    // Should display "2 / 10" (2 Active out of configured 10), NOT "10"
    expect(screen.getByText('2 / 10')).toBeTruthy();
  });

  test('does NOT show the raw fleetSize config value alone when live data exists', () => {
    render(<PulseStrip />);
    // "10" alone must not appear as the tile value
    const tiles = screen.queryAllByText('10');
    expect(tiles).toHaveLength(0);
  });

  test('shows "—" when maintenanceCtx scooters are not yet loaded', () => {
    useMaintenance.mockReturnValue({ tickets: [], scooters: undefined });
    render(<PulseStrip />);
    // scooters undefined → activeScooterCount is null → show "—"
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  test('shows only count (no slash) when config.fleetSize is absent', () => {
    useCosts.mockReturnValue({ costs: [], config: {} });
    render(<PulseStrip />);
    expect(screen.getByText('2')).toBeTruthy();
  });
});

/* ── BUG #617: Net margin tile must use net operating revenue as denominator ── */
describe('PulseStrip — Net margin tile (#617)', () => {
  // Build a revenue row dated in the current calendar month.
  function currentMonthRow(totalPaidRevenue) {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    return { date, totalPaidRevenue };
  }

  test('uses net operating revenue (after Hopp fee + SIM) as denominator, not gross', () => {
    // gross MTD = 1000; one-time cost dated this month = 100
    // operatingRevenueMTD = 1000 * 0.81 - 150 = 660
    // correct margin = round((660 - 100) / 660 * 100) = round(84.85%) = 85%
    // buggy margin (old denominator) = round((1000 - 100) / 1000 * 100) = 90%
    const now = new Date();
    const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    useCosts.mockReturnValue({
      costs: [{ id: 'c1', frequency: 'one-time', amount: 100, startDate }],
      config: { fleetSize: 10 },
    });
    useRevenue.mockReturnValue({ revenueData: [currentMonthRow(1000)] });

    render(<PulseStrip />);
    // Must show 85%, NOT 90% (the buggy gross-denominator value)
    expect(screen.getByText('85%')).toBeTruthy();
    expect(screen.queryByText('90%')).toBeNull();
  });

  test('shows — when no revenue this month', () => {
    useRevenue.mockReturnValue({ revenueData: [] });
    render(<PulseStrip />);
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });
});
