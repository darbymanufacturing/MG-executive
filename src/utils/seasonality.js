/**
 * seasonality.js — derive the Maintenance "Seasonality Index" from real revenue.
 * Autopilot Phase 4 (docs/AUTOMATION_PLAN.md).
 *
 * The index is the € a scooter earns per day in each calendar month; Omni uses
 * it to price downtime ("revenue lost" on open tickets, Investment payback).
 * It was typed in by hand once and never updated — and if left blank it
 * silently priced downtime at €0. This computes it from the last twelve complete
 * months of actual revenue:
 *
 *     index[month] = revenue in that month / (days in month × fleet size)
 *
 * using the most recent occurrence of each calendar month. Months with no
 * revenue data return null, so a caller keeps whatever value it already had
 * instead of writing a misleading zero.
 */

export const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const daysInMonth = (year, monthIdx) => new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();

/**
 * @param {{date:string, totalPaidRevenue:number}[]} revenueDays
 * @param {{fleetSize:number, now?:Date}} opts
 * @returns {{index: Record<string, number|null>, basis: Record<string, string|null>}}
 *   index — € per scooter per day, rounded to cents (null = no data)
 *   basis — which YYYY-MM each month was computed from (for the UI to explain)
 */
export function seasonalityFromRevenue(revenueDays = [], { fleetSize, now = new Date() } = {}) {
  const fleet = Number(fleetSize) || 0;
  const index = Object.fromEntries(MONTH_KEYS.map((k) => [k, null]));
  const basis = Object.fromEntries(MONTH_KEYS.map((k) => [k, null]));
  if (fleet <= 0) return { index, basis };

  // Revenue per YYYY-MM.
  const byMonth = new Map();
  for (const r of revenueDays || []) {
    const ym = String(r?.date || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    byMonth.set(ym, (byMonth.get(ym) || 0) + (Number(r.totalPaidRevenue) || 0));
  }

  // Walk back over the last 12 COMPLETE months (the current month is partial).
  for (let back = 1; back <= 12; back += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const year = d.getUTCFullYear();
    const monthIdx = d.getUTCMonth();
    const ym = `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
    const key = MONTH_KEYS[monthIdx];
    if (index[key] != null) continue; // keep the most recent occurrence
    const revenue = byMonth.get(ym);
    if (!revenue) continue;
    index[key] = Math.round((revenue / (daysInMonth(year, monthIdx) * fleet)) * 100) / 100;
    basis[key] = ym;
  }

  return { index, basis };
}
