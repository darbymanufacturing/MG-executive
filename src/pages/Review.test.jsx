/**
 * Review page render smoke — every kind of held item shows the one control it
 * needs, possible duplicates offer "Same payment", automatic entries offer Undo,
 * and the feeds panel offers Sync now. Contexts are mocked; the page's own
 * logic (overrides, missing-field highlighting, parts matching) runs for real.
 */
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const approve = vi.fn(async () => {});
const merge = vi.fn(async () => {});
const undo = vi.fn(async () => {});
const syncNow = vi.fn(async () => ({ fetched: 3, auto: 1, held: 2 }));

const item = (id, kind, payload, extra = {}) => ({
  _docId: id, kind, source: 'wallet', sourceRef: id, status: 'pending', payload, evidence: {}, reasons: [], ...extra,
});

vi.mock('../context/IntakeContext.jsx', () => ({
  useIntake: () => ({
    pending: [
      item('c1', 'cost', { name: 'ΑΦΜ 094014201', amount: 124, date: '2026-09-18', counterpartVat: '094014201' }, { source: 'mydata' }),
      item('c2', 'cost', { name: 'BP ΚΟΡΙΝΘ', amount: 18, date: '2026-09-21', category: 'Fuel' },
        { match: { type: 'possible_duplicate', targetId: 'p1', why: 'Same amount as "Fuel" (2026-09-20) — same payment?' } }),
      item('l1', 'loan_payment', { name: 'ALPHA BANK', amount: 500, loanId: 'L', loanName: 'Alpha loan', interest: 120, principal: 380 }),
      item('o1', 'ledger', { name: 'Paid to Kostas', amount: 1500, ledgerType: 'salary_payment', ownerUid: 'u1' }),
      item('r1', 'recurring', { name: 'Vodafone', amount: 40, nextDate: '2026-10-05' }, { source: 'rule' }),
      item('s1', 'parts_receipt', { name: 'Delivery', partNames: ['10 brake cable'] }, { source: 'whatsapp' }),
      item('t1', 'ticket', { name: 'Brakes', scooterId: '' }, { source: 'whatsapp' }),
    ],
    recentlyHandled: [
      { _docId: 'h1', status: 'auto_committed', source: 'wallet', payload: { name: 'Starlink', amount: 40 }, decidedBy: 'autopilot' },
      { _docId: 'h2', status: 'approved', source: 'whatsapp', payload: { name: 'Skroutz', amount: 42 }, decidedVia: 'whatsapp' },
    ],
    bySource: { wallet: 4, mydata: 1, whatsapp: 2 },
    owners: [{ _docId: 'u1', displayName: 'Kostas' }],
    autopilot: {
      lastSync: { wallet: { at: new Date().toISOString() } },
      walletCash: { balance: 8200, asOf: '2026-09-23T03:00:00Z' },
    },
    loading: false,
    error: null,
    approve, approveMany: vi.fn(async () => ({ approved: 0, failed: [] })), reject: vi.fn(), merge, undo, syncNow,
  }),
}));
vi.mock('../context/MaintenanceContext.jsx', () => ({
  useMaintenance: () => ({ parts: [{ _docId: 'p-cable', partName: 'Brake cable', unitCost: 6 }] }),
}));
vi.mock('../components/Layout/Header.jsx', () => ({ default: ({ title }) => <h1>{title}</h1> }));

const { default: Review } = await import('./Review.jsx');

describe('Review page', () => {
  test('renders every kind with its control', () => {
    render(<Review />);
    expect(screen.getByText('7')).toBeTruthy();                                  // waiting count
    expect(screen.getByPlaceholderText('Supplier name')).toBeTruthy();          // unnamed myDATA supplier
    expect(screen.getByRole('button', { name: /Same payment/ })).toBeTruthy(); // possible duplicate
    expect(screen.getByPlaceholderText('Interest').value).toBe('120');          // loan split pre-filled
    expect(screen.getByLabelText('Kind of owner money').value).toBe('salary_payment');
    expect(screen.getByText(/Adds to stock: 10 × Brake cable/)).toBeTruthy();   // delivery matched
    expect(screen.getByPlaceholderText('Scooter ID')).toBeTruthy();
    expect(screen.getByText(/Bank today/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Sync now/ })).toHaveLength(2);
  });

  test('Undo is offered only for what Autopilot did on its own', () => {
    render(<Review />);
    expect(screen.getAllByRole('button', { name: /Undo/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Undo/ }));
    expect(undo).toHaveBeenCalledWith(expect.objectContaining({ _docId: 'h1' }));
  });

  test('"Same payment" merges; a delivery approves with its matched parts', () => {
    render(<Review />);
    fireEvent.click(screen.getByRole('button', { name: /Same payment/ }));
    expect(merge).toHaveBeenCalledWith(expect.objectContaining({ _docId: 'c2' }));
    const deliveryRow = screen.getByText(/Adds to stock/).closest('li');
    fireEvent.click(deliveryRow.querySelector('button[title="Approve"]'));
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({ _docId: 's1' }),
      expect.objectContaining({ parts: [{ partId: 'p-cable', qty: 10, name: 'Brake cable' }] }),
    );
  });

  test('the repair without a scooter cannot be approved yet', () => {
    render(<Review />);
    const row = screen.getByPlaceholderText('Scooter ID').closest('li');
    expect(row.querySelector('button[title="Missing: Scooter ID"]').disabled).toBe(true);
  });
});
