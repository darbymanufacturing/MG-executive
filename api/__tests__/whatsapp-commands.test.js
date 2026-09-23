/**
 * api/__tests__/whatsapp-commands.test.js
 *
 * Clearing the review queue from WhatsApp (owner decision: approvals in
 * "WhatsApp + Omni"). What must hold:
 *   - only explicit commands are commands; everything else is a capture
 *   - only APPROVERS may approve (fails closed when unconfigured)
 *   - numbers mean the list the sender is LOOKING AT, not the live queue
 *
 * Run with:  npx vitest run api/__tests__/whatsapp-commands.test.js
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  parseCommand, approverAllowed, ownerForSender, defaultOverrides, digestText,
  overridesFromCorrection, resolveNumbers,
} from '../_lib/whatsapp-commands.js';

afterEach(() => { delete process.env.WHATSAPP_APPROVER_NUMBERS; });

describe('parseCommand', () => {
  it('reads approvals in Greek and English', () => {
    for (const t of ['✅', 'ok', 'OK', 'ναι', 'approve all', 'εντάξει']) expect(parseCommand(t)).toEqual({ cmd: 'approve_all' });
    expect(parseCommand('ok 1 3')).toEqual({ cmd: 'approve', numbers: [1, 3] });
    expect(parseCommand('ok 2,4')).toEqual({ cmd: 'approve', numbers: [2, 4] });
  });
  it('reads rejects, fixes, the list and the brief', () => {
    expect(parseCommand('no 2')).toEqual({ cmd: 'reject', numbers: [2] });
    expect(parseCommand('όχι 5')).toEqual({ cmd: 'reject', numbers: [5] });
    expect(parseCommand('fix 3 18,50 fuel')).toEqual({ cmd: 'fix', number: 3, text: '18,50 fuel' });
    expect(parseCommand('review')).toEqual({ cmd: 'list' });
    expect(parseCommand('?')).toEqual({ cmd: 'list' });
    expect(parseCommand('σύνοψη')).toEqual({ cmd: 'brief' });
  });
  it('leaves real captures alone', () => {
    expect(parseCommand('paid 18 fuel')).toBeNull();
    expect(parseCommand('41735 brake cable, 25 min')).toBeNull();
    expect(parseCommand('ok so the scooter is fixed')).toBeNull();
    expect(parseCommand('')).toBeNull();
  });
});

describe('approverAllowed — crew can report, only approvers sign off money', () => {
  it('fails closed when no approver is configured', () => {
    expect(approverAllowed('306912345678')).toBe(false);
  });
  it('matches on the last nine digits, whatever the prefix', () => {
    process.env.WHATSAPP_APPROVER_NUMBERS = '+30 691 234 5678';
    expect(approverAllowed('306912345678')).toBe(true);
    expect(approverAllowed('306987654321')).toBe(false);
  });
});

describe('owners and defaults', () => {
  const owners = [{ _docId: 'u1', displayName: 'Kostas Marmaras' }, { _docId: 'u2', displayName: 'Panos K' }];
  it('an owner-money item defaults to the sender', () => {
    expect(ownerForSender(owners, 'Kostas')).toBe('u1');
    expect(defaultOverrides({ kind: 'ledger', payload: {}, evidence: { senderName: 'Panos' } }, { owners })).toEqual({ ownerUid: 'u2' });
    expect(defaultOverrides({ kind: 'cost', payload: {} }, { owners })).toEqual({});
  });
});

describe('digestText', () => {
  const pending = [
    { sdid: 'a', item: { kind: 'cost', payload: { name: 'JYSK', amount: 124, category: 'Space & Equipment' } } },
    { sdid: 'b', item: { kind: 'cost', payload: { name: 'ΑΦΜ 0999', amount: 60 } } },
    { sdid: 'c', item: { kind: 'ticket', payload: { name: 'Brakes', scooterId: '' } } },
  ];
  it('numbers the queue, totals it, and says what each item still needs', () => {
    const text = digestText(pending, {});
    expect(text).toMatch(/^3 waiting · €184\.00:/);
    expect(text).toContain('1. Expense: JYSK €124.00');
    expect(text).toContain('2. Expense: ΑΦΜ 0999 €60.00 — needs Category');
    expect(text).toContain('3. Repair: Brakes — needs Scooter ID');
    expect(text).toContain('approve the 1 ready');
  });
  it('is short when there is nothing to do', () => {
    expect(digestText([], {})).toMatch(/Nothing waiting/);
  });
});

describe('corrections and numbering', () => {
  it('turns a correction into fields, never renaming to a bare category word', () => {
    expect(overridesFromCorrection({ amount: 18.5, category: 'Petrol', name: 'Fuel' }, { kind: 'cost' }))
      .toEqual({ amount: 18.5, category: 'Fuel' });
    expect(overridesFromCorrection({ name: 'Kafeneio Nikos' }, { kind: 'cost' })).toEqual({ name: 'Kafeneio Nikos' });
    expect(overridesFromCorrection({ scooterId: '41-735' }, { kind: 'ticket' })).toEqual({ scooterId: '41735' });
  });

  it('resolves numbers against the digest the sender saw, even after the queue changed', () => {
    const pendingNow = [{ sdid: 'b' }, { sdid: 'c' }, { sdid: 'd' }]; // "a" was approved meanwhile
    const r = resolveNumbers([1, 2], { lastDigestIds: ['a', 'b', 'c'], pending: pendingNow });
    expect(r[0]).toEqual({ n: 1, entry: { sdid: 'a', gone: true } });
    expect(r[1].entry.sdid).toBe('b');
  });

  it('falls back to the live order without a stored digest', () => {
    const r = resolveNumbers([2], { pending: [{ sdid: 'x' }, { sdid: 'y' }] });
    expect(r[0].entry.sdid).toBe('y');
  });
});
