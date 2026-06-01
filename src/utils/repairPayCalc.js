/**
 * repairPayCalc.js — pure cost/pay math for a completed repair session (Phase 2.5 F1).
 *
 * A contractor's pay for a job = labour (procedure ESTIMATE × org labour-rate)
 * + any technician-logged extra work + the parts consumed. We pay on the procedure
 * ESTIMATE (not wall-clock minutes) so pay is predictable and not gamed by a slow
 * session; wall-clock `labourMinutes` is still recorded separately for analytics.
 *
 * Pure + dependency-free so it's unit-tested without Firebase/React and reused
 * identically by the SummaryScreen (preview) and repairSessionWriter (persist).
 * All money rounded to cents to avoid float drift.
 */

/** Round to 2 decimals (cents), guarding NaN/Infinity → 0. */
export function round2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

/** Coerce a possibly-missing numeric input to a finite non-negative number. */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Sum parts cost from the aggregated parts-used array.
 * @param {{quantity:number, unitCost:number}[]} partsUsed
 */
export function partsCostOf(partsUsed) {
  if (!Array.isArray(partsUsed)) return 0;
  return round2(partsUsed.reduce((s, p) => s + num(p?.quantity) * num(p?.unitCost), 0));
}

/**
 * Compute the full pay breakdown for a repair.
 * @param {object} args
 * @param {number} args.estimatedMinutes   procedure estimate (the basis for pay)
 * @param {number} args.labourRatePerHour  org labour rate (€/hour)
 * @param {number} [args.extraMinutes=0]   technician-logged extra work
 * @param {{quantity:number, unitCost:number}[]} [args.partsUsed=[]]
 * @returns {{ partsCost, labourCost, extraCost, labourMinutesBilled, totalCost }}
 *          (all € rounded to cents; labourCost = estimate×rate, extraCost = extra×rate)
 */
export function computeRepairPay({
  estimatedMinutes = 0,
  labourRatePerHour = 0,
  extraMinutes = 0,
  partsUsed = [],
} = {}) {
  const rate = num(labourRatePerHour);
  const estMin = num(estimatedMinutes);
  const xtraMin = num(extraMinutes);

  const labourCost = round2((estMin / 60) * rate);
  const extraCost = round2((xtraMin / 60) * rate);
  const partsCost = partsCostOf(partsUsed);
  const totalCost = round2(labourCost + extraCost + partsCost);

  return {
    partsCost,
    labourCost,
    extraCost,
    labourMinutesBilled: estMin + xtraMin,
    totalCost,
  };
}
