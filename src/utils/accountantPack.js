/**
 * accountantPack.js — the month's expenses as one file for the accountant.
 * Autopilot Phase 4 (#700, docs/AUTOMATION_PLAN.md).
 *
 * What counts as "this month's expenses" for an accountant is what was actually
 * incurred/paid in the month, not the monthly run-rate:
 *   - one-time costs dated in the month
 *   - recurring costs whose month is ticked PAID in the settlement ledger
 *     (ADR-0027) — the bank debit Autopilot matched, or the owner's tick
 * Each row links to the original receipt when Omni has it (receiptUrl).
 *
 * The CSV is formatted for Greek Excel: semicolon separators, comma decimals,
 * and a UTF-8 BOM so Greek supplier names open correctly.
 */
import { CATEGORIES } from './constants.js';

const pad2 = (n) => String(n).padStart(2, '0');
// UTF-8 byte-order mark — built from its code point so no invisible character
// lives in the source (no-irregular-whitespace).
const BOM = String.fromCharCode(0xfeff);

/** The rows for one month (YYYY-MM), sorted by date. */
export function monthExpenses(costs = [], month) {
  if (!/^\d{4}-\d{2}$/.test(String(month))) return [];
  const rows = [];

  for (const c of costs) {
    if (!c) continue;
    const isOneTime = !c.frequency || c.frequency === 'one-time';

    if (isOneTime) {
      if (!String(c.startDate || '').startsWith(month)) continue;
      rows.push(rowFor(c, c.startDate));
      continue;
    }

    const settlement = c.settlements?.[month];
    if (settlement?.status !== 'paid') continue;
    // Date the payment on the cost's usual day of month (clamped), or the tick date.
    const day = Number(String(c.startDate || '').slice(8, 10)) || 1;
    const [y, m] = month.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    rows.push(rowFor(c, `${month}-${pad2(Math.min(day, last))}`, settlement.at));
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

function rowFor(c, date, paidAt = null) {
  const amount = Number(c.amount) || 0;
  const vat = c.vatIncluded && Number(c.vatAmount) > 0 ? Number(c.vatAmount) : null;
  return {
    date: String(date).slice(0, 10),
    supplier: c.name || '',
    category: CATEGORIES[c.category]?.label || c.category || '',
    amount,
    vat,
    net: vat != null ? Math.round((amount - vat) * 100) / 100 : null,
    frequency: c.frequency || 'one-time',
    source: c.source || 'manual',
    receiptUrl: c.receiptUrl || '',
    notes: c.notes || '',
    paidAt: paidAt || null,
  };
}

/** Totals for the preview and the email body. */
export function packTotals(rows = []) {
  const round = (n) => Math.round(n * 100) / 100;
  return {
    count: rows.length,
    total: round(rows.reduce((s, r) => s + r.amount, 0)),
    vat: round(rows.reduce((s, r) => s + (r.vat || 0), 0)),
    withReceipt: rows.filter((r) => r.receiptUrl).length,
  };
}

const money = (n) => (n == null ? '' : Number(n).toFixed(2).replace('.', ','));

function cell(v) {
  const s = String(v ?? '');
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV text (with BOM) for Greek-locale Excel. */
export function packCsv(rows = []) {
  const header = ['Date', 'Supplier', 'Category', 'Gross (EUR)', 'VAT (EUR)', 'Net (EUR)', 'Frequency', 'Source', 'Receipt', 'Notes'];
  const lines = [header.join(';')];
  for (const r of rows) {
    lines.push([
      r.date, r.supplier, r.category, money(r.amount), money(r.vat), money(r.net),
      r.frequency, r.source, r.receiptUrl, r.notes,
    ].map(cell).join(';'));
  }
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

/** The previous calendar month as YYYY-MM (the pack is sent early each month). */
export function previousMonth(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}
