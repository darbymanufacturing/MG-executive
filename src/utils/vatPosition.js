/**
 * vatPosition.js — what the company owes in VAT, quarter by quarter
 * (AUTOMATION_PLAN §5 "Taxes / VAT": input VAT from invoices, finally consumed).
 *
 *   output VAT  VAT on revenue — revenueBreakdown().vatPortion, the same number
 *               the numbers hub uses (revenue is stored ex-VAT; VAT = revenue × rate)
 *   input VAT   VAT recorded on the quarter's expenses, on the accountant-pack basis
 *               (one-off costs in the month + recurring bills ticked PAID)
 *   net         output − input: positive = payable to the state, negative = credit
 *   paid        what was actually paid in the "VAT" category that quarter
 *   coverage    how many of the quarter's expenses carry a VAT figure — the input
 *               VAT is only as complete as that
 *   aade        input VAT on the supplier invoices myDATA sent Autopilot — the
 *               state's own view, as a cross-check (null when no myDATA feed)
 *
 * Pure. An estimate for planning; the accountant files the return.
 */
import { monthExpenses } from './accountantPack.js';
import { revenueBreakdown } from './revenueCalculations.js';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const QUARTER_MONTHS = [['01', '02', '03'], ['04', '05', '06'], ['07', '08', '09'], ['10', '11', '12']];

export function vatPositionByQuarter({
  costs = [], revenue = [], financial = {}, year, intake = [], now = new Date(),
} = {}) {
  const vatPayments = costs.filter((c) => c?.category === 'VAT');
  const expenses = costs.filter((c) => c?.category !== 'VAT');
  const mydata = intake.filter((i) => i?.source === 'mydata' && Number(i.payload?.vatAmount) > 0);
  const nowKey = now.toISOString().slice(0, 7);

  return QUARTER_MONTHS.map((months, qi) => {
    const keys = months.map((m) => `${year}-${m}`);
    const started = keys[0] <= nowKey;

    const revRows = revenue.filter((r) => keys.includes(String(r?.date || '').slice(0, 7)));
    const output = round2(revenueBreakdown(revRows, financial, 3).vatPortion || 0);

    let input = 0;
    let count = 0;
    let withVat = 0;
    let paid = 0;
    for (const key of keys) {
      for (const row of monthExpenses(expenses, key)) {
        count += 1;
        if (row.vat != null) { withVat += 1; input += row.vat; }
      }
      for (const row of monthExpenses(vatPayments, key)) paid += row.amount;
    }

    const aadeRows = mydata.filter((i) => keys.includes(String(i.payload?.date || '').slice(0, 7)));
    return {
      quarter: `Q${qi + 1}`,
      months: keys,
      started,
      output,
      input: round2(input),
      net: round2(output - input),
      paid: round2(paid),
      coverage: { withVat, count },
      aade: mydata.length ? round2(aadeRows.reduce((s, i) => s + Number(i.payload.vatAmount), 0)) : null,
    };
  });
}
