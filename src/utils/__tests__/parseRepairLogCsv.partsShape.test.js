/**
 * Regression tests for #696 — the repair-log importer stored `partsUsed` as raw
 * text, while the rest of the app treats it as an array of costed parts. In
 * RepairsTab, `t.partsUsed?.length` was truthy for a non-empty string and the
 * following `.reduce` threw, crashing that scooter's Repairs tab.
 */
import { describe, it, expect } from 'vitest';
import { parseRepairLogCsv } from '../parseRepairLogCsv.js';

const CSV = [
  'Issue Type,Issue Tags,Real Issue,Comment,Parts used,Created,Fixed,Fixed By',
  'BRAKE,other,BRAKE,Front brake cable snapped,"brake cable, grip",01/09/2026,03/09/2026,Kostas',
  'LIGHT,other,LIGHT,Rear light dead,,02/09/2026,,Panos',
].join('\n');

describe('parseRepairLogCsv — parts shape (#696)', () => {
  const { tickets } = parseRepairLogCsv(CSV, '41735');

  it('parses both rows', () => {
    expect(tickets).toHaveLength(2);
  });

  it('always emits partsUsed as an array, never a string', () => {
    for (const t of tickets) {
      expect(Array.isArray(t.partsUsed)).toBe(true);
      expect(t.partsUsed).toHaveLength(0); // imports carry no costed parts
    }
  });

  it('preserves the human-readable parts text separately', () => {
    expect(tickets[0].partsUsedText).toBe('brake cable, grip');
    expect(tickets[1].partsUsedText).toBe('');
  });

  it('survives the RepairsTab cost reduction that used to throw', () => {
    // Exactly the expression RepairsTab evaluates for each row.
    const total = (t) =>
      Array.isArray(t.partsUsed) && t.partsUsed.length
        ? t.partsUsed.reduce((s, p) => s + (p.quantity || 0) * (p.unitCost || 0), 0)
        : null;
    expect(() => tickets.map(total)).not.toThrow();
    expect(tickets.map(total)).toEqual([null, null]);
  });
});
