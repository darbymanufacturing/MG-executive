/**
 * financeRules.js — the internal bookkeeping rules of AUTOMATION_PLAN §4.6 that
 * need no outside source, only what Omni already knows:
 *
 *   detectRecurringBills   same payee three months running → suggest a standing
 *                          commitment (held for approval — never auto-created)
 *   salaryAccrualsDue      on the 1st, each owner's monthly salary becomes a held
 *                          "salary accrued" ledger item
 *   ownerForCounterparty   a bank line to/from an owner is ledger money, not a cost
 *
 * Pure: shared by the finance cron and the tests.
 */
import { payeeKey, payeesMatch, canonicalCategory } from './intake.js';
import { isCommitment } from './upcomingPayments.js';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const monthOf = (d) => String(d || '').slice(0, 7);

function prevMonths(monthKey, n) {
  const [y, m] = monthKey.split('-').map(Number);
  const out = [];
  for (let i = 1; i <= n; i += 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Payees paid in each of the last three COMPLETE months with a steady amount
 * (every month within ±10% of the median) and no standing commitment yet.
 * Each becomes one suggestion; approving it creates a monthly commitment that
 * starts next month, so later debits tick it paid instead of piling up as
 * one-off costs.
 */
export function detectRecurringBills(costs = [], { now = new Date(), tolerance = 0.1 } = {}) {
  const thisMonth = now.toISOString().slice(0, 7);
  const window = prevMonths(thisMonth, 3); // e.g. Jun, Jul, Aug when it's September
  const oneOffs = costs.filter((c) => c && (!c.frequency || c.frequency === 'one-time')
    && window.includes(monthOf(c.startDate)) && Number(c.amount) > 0 && c.name);

  const byPayee = new Map();
  for (const c of oneOffs) {
    const key = payeeKey(c.name).replace(/ /g, '');
    if (key.length < 3) continue;
    if (!byPayee.has(key)) byPayee.set(key, []);
    byPayee.get(key).push(c);
  }

  const commitments = costs.filter((c) => isCommitment(c, { now }));
  const suggestions = [];
  for (const [key, list] of byPayee) {
    const months = new Set(list.map((c) => monthOf(c.startDate)));
    if (!window.every((m) => months.has(m))) continue;

    // One amount per month (a payee billed twice in a month isn't a simple bill).
    const perMonth = window.map((m) => list.filter((c) => monthOf(c.startDate) === m));
    if (perMonth.some((l) => l.length !== 1)) continue;
    const amounts = perMonth.map((l) => Number(l[0].amount));
    const mid = median(amounts);
    if (amounts.some((a) => Math.abs(a - mid) > mid * tolerance)) continue;

    const latest = perMonth[0][0]; // window[0] is the most recent month
    if (commitments.some((c) => payeesMatch(c.name, latest.name))) continue;

    const day = Math.min(28, Number(String(latest.startDate).slice(8, 10)) || 1);
    const categories = list.map((c) => canonicalCategory(c.category)).filter(Boolean);
    const category = categories.sort((a, b) => categories.filter((x) => x === b).length
      - categories.filter((x) => x === a).length)[0] || null;

    suggestions.push({
      sourceRef: `recurring_${key.slice(0, 60)}`,
      kind: 'recurring',
      payload: {
        name: latest.name,
        amount: round2(mid),
        category,
        frequency: 'monthly',
        date: latest.startDate,
        nextDate: `${thisMonth}-${String(day).padStart(2, '0')}`,
        notes: `Paid ${window.slice().reverse().map((m, i) => `${m}: €${amounts[2 - i].toFixed(2)}`).join(', ')}`,
      },
      evidence: { months: window, costIds: list.map((c) => c.id).filter(Boolean) },
    });
  }
  return suggestions;
}

/**
 * This month's salary accruals, one per owner with a monthly salary set
 * (Owner ledger → salary). Idempotent by sourceRef: one per owner per month.
 */
export function salaryAccrualsDue(owners = [], salaries = {}, { now = new Date() } = {}) {
  const period = now.toISOString().slice(0, 7);
  return owners
    .filter((o) => Number(salaries?.[o._docId]) > 0)
    .map((o) => ({
      sourceRef: `salary_${o._docId}_${period}`,
      kind: 'ledger',
      payload: {
        name: `Salary ${period} — ${o.displayName || 'owner'}`,
        amount: round2(salaries[o._docId]),
        date: `${period}-01`,
        ownerUid: o._docId,
        ledgerType: 'salary_accrual',
        period,
      },
      evidence: { rule: 'monthly salary accrual' },
    }));
}

/**
 * The owner a bank counterparty names ("Kostas Marmaras", "ΜΑΡΜΑΡΑΣ ΚΩΝΣΤΑΝΤΙΝΟΣ"),
 * or null. Needs the owner's full display name to appear — a first name alone
 * ("Kostas") would catch every Kostas the company pays.
 */
export function ownerForCounterparty(owners = [], counterparty) {
  const text = payeeKey(counterparty);
  if (!text) return null;
  return owners.find((o) => {
    const parts = payeeKey(o.displayName).split(' ').filter((p) => p.length >= 3);
    return parts.length >= 2 && parts.every((p) => text.includes(p));
  }) || null;
}
