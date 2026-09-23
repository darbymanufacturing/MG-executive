/**
 * powWeek.js — POW week numbering, shared by PowContext (the app) and the
 * server (WhatsApp tasks, the Monday recap). Pure; moved out of PowContext.jsx
 * so serverless code can use it without importing React or Firebase. The
 * context re-exports both functions for existing callers.
 */

// Week 1 = Nov 3, 2025 (Monday) — must match Pow.jsx
const WEEK1_START_MS = new Date('2025-11-03T00:00:00').getTime();
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** POW week number containing `ms` (same origin as the Week-1 anchor). */
export function weekForMs(ms) {
  return Math.max(1, Math.ceil((ms - WEEK1_START_MS) / WEEK_MS));
}

/**
 * Resolve which POW week to show (#695).
 *
 * A stored `currentWeek` is a manual nudge (the chevrons), valid only while it
 * was set inside the week we are actually in. Before this, `stored || computed`
 * meant the first click ever latched the tracker permanently: the stored number
 * always won, the week stopped advancing on Mondays, and no UI could undo it.
 * Legacy rows have no `currentWeekSetAt`, so they read as stale and self-heal.
 */
export function resolveCurrentWeek(config, nowMs = Date.now()) {
  const computedWeek = weekForMs(nowMs);
  const storedWeek = Number(config?.currentWeek) || null;
  const setAtMs = config?.currentWeekSetAt ? Date.parse(config.currentWeekSetAt) : NaN;
  const storedIsForThisWeek = Number.isFinite(setAtMs) && weekForMs(setAtMs) === computedWeek;
  const currentWeek = storedWeek && storedIsForThisWeek ? storedWeek : computedWeek;
  return { currentWeek, computedWeek, isWeekOverridden: currentWeek !== computedWeek };
}
