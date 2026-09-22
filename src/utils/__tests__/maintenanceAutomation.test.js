/**
 * Tests for Autopilot Phase 3 — maintenance bookkeeping the work already implies.
 * These rules move money (repair costs), stock and fleet availability without a
 * human in the loop, so each one is pinned down here.
 */
import { describe, it, expect } from 'vitest';
import {
  isOpenTicket,
  scooterStatusAfter,
  completionCostFields,
  stockAfterUse,
  openTicketForScooter,
  dueScheduleTickets,
  reorderSuggestions,
  draftOrderText,
  matchPartsByName,
} from '../maintenanceAutomation.js';

describe('scooterStatusAfter — ticket ⇄ scooter coupling', () => {
  const open = { scooterId: '41735', status: 'Backlog' };
  const done = { scooterId: '41735', status: 'Completed' };

  it('puts an Active scooter In Repair when it has an open ticket', () => {
    expect(scooterStatusAfter({ scooterId: '41735', status: 'Active' }, [open])).toBe('In Repair');
  });

  it('returns it to Active when its last open ticket closes', () => {
    expect(scooterStatusAfter({ scooterId: '41735', status: 'In Repair' }, [done])).toBe('Active');
  });

  it('leaves it alone when nothing changes', () => {
    expect(scooterStatusAfter({ scooterId: '41735', status: 'In Repair' }, [open])).toBeNull();
    expect(scooterStatusAfter({ scooterId: '41735', status: 'Active' }, [done])).toBeNull();
  });

  it('never overrides deliberate statuses (Donor, Retired, To be Repainted)', () => {
    for (const status of ['Donor', 'Retired', 'To be Repainted']) {
      expect(scooterStatusAfter({ scooterId: '41735', status }, [open])).toBeNull();
    }
  });

  it("ignores other scooters' tickets and treats Donor tickets as closed", () => {
    expect(scooterStatusAfter({ scooterId: '41735', status: 'Active' }, [{ scooterId: '51946', status: 'Active' }])).toBeNull();
    expect(isOpenTicket({ status: 'Donor' })).toBe(false);
  });
});

describe('completionCostFields — same math as the crew flow', () => {
  it('costs labour at the configured rate and adds parts', () => {
    const f = completionCostFields({
      labourMinutes: 30,
      labourRatePerHour: 25,
      partsUsed: [{ partId: 'p1', quantity: 2, unitCost: 4.5 }],
    });
    expect(f.labourCost).toBe(12.5);
    expect(f.totalPartsCost).toBe(9);
    expect(f.totalCost).toBe(21.5);
    expect(f.costStatus).toBe('pending'); // → Cost Approvals, like a technician repair
  });

  it('returns nothing to stamp for a bare completion', () => {
    expect(completionCostFields({})).toEqual({});
    expect(completionCostFields({ labourMinutes: 0, partsUsed: [] })).toEqual({});
  });

  it('drops zero-quantity parts', () => {
    const f = completionCostFields({ labourMinutes: 0, partsUsed: [{ partId: 'p1', quantity: 0, unitCost: 9 }] });
    expect(f).toEqual({});
  });
});

describe('stockAfterUse', () => {
  const parts = [
    { _docId: 'org_2031600021', sku: '2031600021', stockOnHand: 3 },
    { _docId: 'org_2030700020', sku: '2030700020', stockOnHand: 1 },
  ];

  it('deducts by part id or SKU and sums repeats', () => {
    const out = stockAfterUse(parts, [
      { partId: 'org_2031600021', quantity: 1 },
      { sku: '2031600021', quantity: 1 },
    ]);
    expect(out).toEqual([{ docId: 'org_2031600021', stockOnHand: 1 }]);
  });

  it('never goes below zero', () => {
    expect(stockAfterUse(parts, [{ partId: 'org_2030700020', quantity: 5 }]))
      .toEqual([{ docId: 'org_2030700020', stockOnHand: 0 }]);
  });

  it('ignores unknown parts and non-positive quantities', () => {
    expect(stockAfterUse(parts, [{ partId: 'nope', quantity: 1 }, { partId: 'org_2030700020', quantity: 0 }])).toEqual([]);
  });
});

describe('openTicketForScooter', () => {
  it('returns the newest open ticket for that scooter', () => {
    const tickets = [
      { _docId: 'a', scooterId: '41735', status: 'Backlog', dateEntered: '2026-08-01' },
      { _docId: 'b', scooterId: '41735', status: 'Blocked', dateEntered: '2026-09-01' },
      { _docId: 'c', scooterId: '41735', status: 'Completed', dateEntered: '2026-09-10' },
    ];
    expect(openTicketForScooter(tickets, '41735')._docId).toBe('b');
    expect(openTicketForScooter(tickets, '99999')).toBeNull();
  });
});

describe('dueScheduleTickets', () => {
  const schedules = [
    { _docId: 's1', scooterId: '41735', title: 'Brake check', nextDue: '2026-09-20', status: 'active' },
    { _docId: 's2', scooterId: '51946', title: 'Tyre check', nextDue: '2026-10-01', status: 'active' },
    { _docId: 's3', scooterId: '69549', title: 'One-off', nextDue: '2026-09-01', status: 'done' },
  ];

  it('raises a ticket for every due, active schedule', () => {
    const out = dueScheduleTickets(schedules, [], '2026-09-22');
    expect(out.map((t) => t.scheduleId)).toEqual(['s1']);
    expect(out[0].scooterId).toBe('41735');
    expect(out[0].status).toBe('Backlog');
  });

  it('does not duplicate a ticket that is already open for that schedule', () => {
    const tickets = [{ scheduleId: 's1', status: 'Backlog' }];
    expect(dueScheduleTickets(schedules, tickets, '2026-09-22')).toEqual([]);
  });

  it('raises it again once the previous ticket is closed', () => {
    const tickets = [{ scheduleId: 's1', status: 'Completed' }];
    expect(dueScheduleTickets(schedules, tickets, '2026-09-22')).toHaveLength(1);
  });
});

describe('reorderSuggestions + draftOrderText', () => {
  const parts = [
    { _docId: 'p1', sku: '1', partName: 'Brake cable', stockOnHand: 1, reorderPoint: 3, unitCost: 4, supplier: 'Okai' },
    { _docId: 'p2', sku: '2', partName: 'Grip', stockOnHand: 10, reorderPoint: 3, unitCost: 2, supplier: 'Okai' },
    { _docId: 'p3', sku: '3', partName: 'Tyre', stockOnHand: 0, reorderPoint: 2, unitCost: 15, unitsOnOrder: 4 },
    { _docId: 'p4', sku: '4', partName: 'Old', stockOnHand: 0, reorderPoint: 2, status: 'Discontinued' },
  ];

  it('suggests only low, not-on-order, active parts, topped up to 2× the reorder point', () => {
    const out = reorderSuggestions(parts);
    expect(out.map((s) => s.docId)).toEqual(['p1']);
    expect(out[0].quantity).toBe(5);      // 2×3 − 1
    expect(out[0].lineTotal).toBe(20);
  });

  it('groups a draft order per supplier', () => {
    const [order] = draftOrderText(reorderSuggestions(parts), { company: 'Omni' });
    expect(order.supplier).toBe('Okai');
    expect(order.text).toContain('5 × Brake cable (SKU 1)');
    expect(order.total).toBe(20);
  });
});

describe('matchPartsByName — conservative on purpose', () => {
  const parts = [
    { _docId: 'p1', sku: '1', partName: 'Brake cable', unitCost: 4 },
    { _docId: 'p2', sku: '2', partName: 'Throttle cable', unitCost: 6 },
    { _docId: 'p3', sku: '3', partName: 'Handlebar grip', unitCost: 2 },
  ];

  it('matches an unambiguous name, with a quantity', () => {
    const { matched } = matchPartsByName(['2 brake cable'], parts);
    expect(matched).toEqual([{ partId: 'p1', sku: '1', partName: 'Brake cable', quantity: 2, unitCost: 4 }]);
  });

  it('refuses an ambiguous name rather than guessing', () => {
    const { matched, unmatched } = matchPartsByName(['cable'], parts);
    expect(matched).toEqual([]);
    expect(unmatched).toEqual(['cable']);
  });

  it('keeps unknown parts for the human note', () => {
    const { matched, unmatched } = matchPartsByName(['grip', 'flux capacitor'], parts);
    expect(matched.map((m) => m.partId)).toEqual(['p3']);
    expect(unmatched).toEqual(['flux capacitor']);
  });

  it('accepts "x2" suffixes', () => {
    expect(matchPartsByName(['handlebar grip x2'], parts).matched[0].quantity).toBe(2);
  });
});
