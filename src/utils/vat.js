// Pure VAT-splitting helpers shared by the Costs (gross → net + VAT) and Revenue
// (strip VAT before storing ex-VAT) VAT-awareness features. Zero deps, no rounding
// surprises: both functions round to 2dp (cents) since every caller deals in EUR.

/**
 * Split a gross (VAT-included) amount into { net, vat }.
 * net = gross / (1 + rate); vat = gross - net. Both rounded to 2dp.
 *
 * Guards: a missing/invalid/non-positive rate means "no VAT to split out" —
 * returns the gross amount unchanged as `net` with `vat: 0` rather than throwing
 * or dividing by a bad number, so callers never need to pre-validate the config.
 *
 * @param {number} gross - the VAT-included amount (cash paid / received)
 * @param {number} rate  - VAT rate as a decimal (e.g. 0.24 for 24%)
 * @returns {{ net: number, vat: number }}
 */
export function vatSplit(gross, rate) {
  const g = Number(gross);
  const r = Number(rate);

  if (!Number.isFinite(g)) return { net: 0, vat: 0 };
  if (!Number.isFinite(r) || r <= 0) return { net: round2(g), vat: 0 };

  const net = g / (1 + r);
  const vat = g - net;
  return { net: round2(net), vat: round2(vat) };
}

/**
 * Strip VAT from a gross amount, returning just the net (ex-VAT) figure.
 * Thin convenience wrapper around vatSplit() for callers that only need `net`.
 *
 * @param {number} gross
 * @param {number} rate
 * @returns {number}
 */
export function stripVat(gross, rate) {
  return vatSplit(gross, rate).net;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
