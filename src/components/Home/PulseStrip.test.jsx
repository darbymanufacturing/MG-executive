import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// Mock Firebase and all context modules so the module load succeeds without real credentials.
vi.mock('../../lib/firebase.js', () => ({ db: {}, auth: {} }));
vi.mock('../../context/CostContext.jsx', () => ({ useCosts: vi.fn() }));
vi.mock('../../context/RevenueContext.jsx', () => ({ useRevenue: vi.fn() }));
vi.mock('../../context/MaintenanceContext.jsx', () => ({ useMaintenance: vi.fn() }));
vi.mock('./PulseStrip.module.css', () => ({ default: {} }));
// lucide-react stubs
vi.mock('lucide-react', () => ({
  ArrowUp: () => null,
  ArrowDown: () => null,
  Minus: () => null,
}));

import { useCosts } from '../../context/CostContext.jsx';
import { useRevenue } from '../../context/RevenueContext.jsx';
import { useMaintenance } from '../../context/MaintenanceContext.jsx';
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
