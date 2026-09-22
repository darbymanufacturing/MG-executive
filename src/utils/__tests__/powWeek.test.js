/**
 * Regression tests for #695 — the POW week counter latched forever after the
 * first manual chevron click, because the stored week always beat the computed
 * one (`configItem?.currentWeek || computeCurrentWeek()`).
 *
 * resolveCurrentWeek honours a stored week ONLY for the week it was set in.
 */
import { describe, it, expect } from 'vitest';
import { resolveCurrentWeek, weekForMs } from '../../context/PowContext.jsx';

// Week 1 starts Mon 2025-11-03 (local midnight), matching the provider.
const week1Monday = new Date('2025-11-03T00:00:00');
const dayMs = 24 * 60 * 60 * 1000;
const inWeek = (n, dayOffset = 2) =>
  week1Monday.getTime() + (n - 1) * 7 * dayMs + dayOffset * dayMs;

describe('weekForMs', () => {
  it('numbers weeks from the Week-1 anchor', () => {
    expect(weekForMs(inWeek(1))).toBe(1);
    expect(weekForMs(inWeek(2))).toBe(2);
    expect(weekForMs(inWeek(38))).toBe(38);
  });

  it('never returns less than 1 for dates before the anchor', () => {
    expect(weekForMs(week1Monday.getTime() - 30 * dayMs)).toBe(1);
  });
});

describe('resolveCurrentWeek', () => {
  it('uses the computed week when nothing is stored', () => {
    const now = inWeek(40);
    expect(resolveCurrentWeek(null, now)).toEqual({
      currentWeek: 40, computedWeek: 40, isWeekOverridden: false,
    });
  });

  it('honours a manual week chosen during the current week', () => {
    const now = inWeek(40);
    const config = { currentWeek: 38, currentWeekSetAt: new Date(inWeek(40, 1)).toISOString() };
    expect(resolveCurrentWeek(config, now)).toEqual({
      currentWeek: 38, computedWeek: 40, isWeekOverridden: true,
    });
  });

  it('drops the override once the real week rolls over (the #695 latch)', () => {
    const setAt = new Date(inWeek(40, 1)).toISOString();
    const config = { currentWeek: 38, currentWeekSetAt: setAt };
    // Same override, but "now" is the following week → back to automatic.
    expect(resolveCurrentWeek(config, inWeek(41))).toEqual({
      currentWeek: 41, computedWeek: 41, isWeekOverridden: false,
    });
  });

  it('treats legacy rows with no timestamp as stale, healing an already-latched org', () => {
    const config = { currentWeek: 38 }; // written before the fix
    expect(resolveCurrentWeek(config, inWeek(44))).toEqual({
      currentWeek: 44, computedWeek: 44, isWeekOverridden: false,
    });
  });

  it('ignores an unparseable timestamp', () => {
    const config = { currentWeek: 12, currentWeekSetAt: 'not-a-date' };
    expect(resolveCurrentWeek(config, inWeek(44)).currentWeek).toBe(44);
  });

  it('is not confused by a stored week equal to the computed one', () => {
    const now = inWeek(40);
    const config = { currentWeek: 40, currentWeekSetAt: new Date(now).toISOString() };
    expect(resolveCurrentWeek(config, now).isWeekOverridden).toBe(false);
  });
});
