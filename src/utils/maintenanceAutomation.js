/**
 * maintenanceAutomation.js — the rules behind Omni Autopilot Phase 3
 * (docs/AUTOMATION_PLAN.md: "Maintenance autopilot").
 *
 * Maintenance was one of the owner's three biggest manual chores. These pure
 * functions remove the bookkeeping that the work itself already implies:
 *
 *   - opening a repair ticket puts the scooter "In Repair"; closing its last one
 *     puts it back to "Active"                          (scooterStatusAfter)
 *   - every completion is costed the same way, whoever closes it
 *                                                     (completionCostFields)
 *   - parts used come off the shelf                   (stockAfterUse)
 *   - a "done" message closes the open ticket instead of opening a new one
 *                                                     (openTicketForScooter)
 *   - a due preventive service becomes a ticket on its due date
 *                                                     (dueScheduleTickets)
 *   - low stock becomes a draft order, never an automatic one
 *                                                     (reorderSuggestions)
 *
 * Pure (no React, no Supabase) so the context, the server cron and the tests
 * all share one implementation.
 */
import { computeRepairPay, round2 } from './repairPayCalc.js';

/** Ticket statuses that no longer need work (MaintenanceContext TERMINAL_STATUSES). */
export const TERMINAL_TICKET_STATUSES = new Set(['Completed', 'Donor']);

/** Scooter statuses the automation must never override — they're deliberate decisions. */
const PROTECTED_SCOOTER_STATUSES = new Set(['Donor', 'Retired', 'To be Repainted']);

export const isOpenTicket = (t) => Boolean(t) && !TERMINAL_TICKET_STATUSES.has(t.status);

const sameScooter = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();

/**
 * The status a scooter SHOULD have given its tickets, or null to leave it alone.
 *
 * Before this, ticket and scooter status were two manually-synced universes: the
 * "Revenue bleedthrough/day" KPI counted scooters marked In Repair while revenue
 * lost was computed from open tickets, and nobody kept them aligned.
 */
export function scooterStatusAfter(scooter, tickets = []) {
  if (!scooter) return null;
  const current = scooter.status || 'Active';
  if (PROTECTED_SCOOTER_STATUSES.has(current)) return null;

  const hasOpen = tickets.some((t) => sameScooter(t.scooterId, scooter.scooterId) && isOpenTicket(t));
  if (hasOpen && current === 'Active') return 'In Repair';
  if (!hasOpen && current === 'In Repair') return 'Active';
  return null;
}

/**
 * Cost fields to stamp on a ticket when it is completed outside the crew flow
 * (admin "Mark Completed", a WhatsApp "done" message). Same math as the crew
 * flow's repairSessionWriter (computeRepairPay), so a repair costs the same no
 * matter who closes it. Lands as `costStatus: 'pending'`, i.e. it goes through
 * Cost Approvals exactly like a technician's repair.
 *
 * Returns {} when there is nothing to cost, so a bare completion stays bare.
 */
export function completionCostFields({ labourMinutes = 0, partsUsed = [], labourRatePerHour = 0 } = {}) {
  const minutes = Math.max(0, Number(labourMinutes) || 0);
  const parts = Array.isArray(partsUsed) ? partsUsed.filter((p) => Number(p?.quantity) > 0) : [];
  if (minutes === 0 && parts.length === 0) return {};

  const pay = computeRepairPay({
    estimatedMinutes: minutes,
    labourRatePerHour,
    extraMinutes: 0,
    partsUsed: parts,
  });

  return {
    labourMinutes: minutes,
    labourRatePerHour: Number(labourRatePerHour) || 0,
    labourCost: pay.labourCost,
    totalPartsCost: pay.partsCost,
    totalCost: pay.totalCost,
    partsUsed: parts,
    costStatus: 'pending',
  };
}

/**
 * New stock levels after using parts. Never goes below zero — a mis-count on
 * the shelf must not produce negative inventory that poisons reorder math.
 *
 * @param {object[]} parts      inventory rows ({_docId, sku, stockOnHand})
 * @param {object[]} partsUsed  [{partId|sku, quantity}]
 * @returns {{docId:string, stockOnHand:number}[]}
 */
export function stockAfterUse(parts = [], partsUsed = []) {
  const byKey = new Map();
  for (const p of parts) {
    if (p?._docId) byKey.set(String(p._docId), p);
    if (p?.sku != null) byKey.set(`sku:${String(p.sku).replace(/\.0$/, '').trim()}`, p);
  }

  const totals = new Map();
  for (const used of partsUsed || []) {
    const qty = Number(used?.quantity) || 0;
    if (qty <= 0) continue;
    const part = byKey.get(String(used.partId ?? ''))
      || byKey.get(`sku:${String(used.sku ?? '').replace(/\.0$/, '').trim()}`);
    if (!part) continue;
    totals.set(part._docId, (totals.get(part._docId) || 0) + qty);
  }

  return [...totals.entries()].map(([docId, qty]) => {
    const part = parts.find((p) => p._docId === docId);
    return { docId, stockOnHand: Math.max(0, (Number(part?.stockOnHand) || 0) - qty) };
  });
}

const normName = (s) => String(s ?? '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '') // Greek tonos + Latin accents
  .replace(/[^a-z0-9α-ω ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Match free-text part names (from a voice note or chat: "brake cable", "grip")
 * to catalog parts. Conservative on purpose: a name only matches when exactly
 * ONE catalog part contains it (or it contains exactly one part name) — an
 * ambiguous "cable" must not silently deduct the wrong SKU. Unmatched names are
 * returned so they can stay in the ticket note for a human.
 *
 * @returns {{matched: {partId, sku, partName, quantity, unitCost}[], unmatched: string[]}}
 */
export function matchPartsByName(names = [], parts = []) {
  const catalog = parts
    .filter((p) => p && p.status !== 'Discontinued')
    .map((p) => ({ part: p, key: normName(p.partName || p.name) }))
    .filter((c) => c.key.length >= 3);

  const matched = [];
  const unmatched = [];

  for (const raw of names || []) {
    // "2 brake pads" / "brake pads x2" → quantity 2
    const text = String(raw || '').trim();
    const qtyMatch = text.match(/^(\d+)\s*[x×]?\s+(.+)$/i) || text.match(/^(.+?)\s*[x×]\s*(\d+)$/i);
    let quantity = 1;
    let name = text;
    if (qtyMatch) {
      if (/^\d+$/.test(qtyMatch[1])) { quantity = Number(qtyMatch[1]); name = qtyMatch[2]; }
      else { name = qtyMatch[1]; quantity = Number(qtyMatch[2]); }
    }
    const key = normName(name);
    if (key.length < 3) { if (text) unmatched.push(text); continue; }

    const hits = catalog.filter((c) => c.key === key || c.key.includes(key) || key.includes(c.key));
    const exact = hits.filter((c) => c.key === key);
    const chosen = exact.length === 1 ? exact[0] : (hits.length === 1 ? hits[0] : null);

    if (chosen) {
      matched.push({
        partId: chosen.part._docId,
        sku: chosen.part.sku,
        partName: chosen.part.partName || chosen.part.name,
        quantity: Math.max(1, quantity || 1),
        unitCost: Number(chosen.part.unitCost) || 0,
      });
    } else {
      unmatched.push(text);
    }
  }
  return { matched, unmatched };
}

/** The most recent OPEN ticket for a scooter, or null. */
export function openTicketForScooter(tickets = [], scooterId) {
  const open = tickets
    .filter((t) => sameScooter(t.scooterId, scooterId) && isOpenTicket(t))
    .sort((a, b) => String(b.dateEntered || '').localeCompare(String(a.dateEntered || '')));
  return open[0] || null;
}

/**
 * Preventive-maintenance schedules that are due (or overdue) today and do not
 * already have an open ticket raised from them. Each becomes a ticket, so the
 * owner no longer has to click "Ticket" on the due date.
 */
export function dueScheduleTickets(schedules = [], tickets = [], today = new Date().toISOString().slice(0, 10)) {
  const openFromSchedule = new Set(
    tickets.filter(isOpenTicket).map((t) => t.scheduleId).filter(Boolean),
  );
  return schedules
    .filter((s) => (s.status || 'active') === 'active')
    .filter((s) => s.nextDue && s.nextDue <= today)
    .filter((s) => !openFromSchedule.has(s._docId))
    .map((s) => ({
      scheduleId: s._docId,
      scooterId: String(s.scooterId || '').trim(),
      dateEntered: today,
      category: 'Q',
      status: 'Backlog',
      primaryTag: 'Scheduled',
      issueDescription: s.title || 'Scheduled maintenance',
      notes: [
        `Raised automatically: "${s.title || 'service'}" was due ${s.nextDue}.`,
        s.notes || null,
      ].filter(Boolean).join('\n'),
      source: 'autopilot-schedule',
    }));
}

/**
 * Parts to reorder now. Suggests enough to reach twice the reorder point —
 * a simple, explainable rule the owner can override — and skips anything
 * already on order or discontinued. These become DRAFT orders only: nothing is
 * sent to a supplier without the owner's approval.
 */
export function reorderSuggestions(parts = []) {
  return parts
    .filter((p) => p && p.status !== 'Discontinued')
    .filter((p) => Number(p.reorderPoint) > 0 && Number(p.stockOnHand) <= Number(p.reorderPoint))
    .filter((p) => !(Number(p.unitsOnOrder) > 0))
    .map((p) => {
      const target = Number(p.reorderPoint) * 2;
      const qty = Math.max(1, Math.ceil(target - (Number(p.stockOnHand) || 0)));
      return {
        docId: p._docId,
        sku: p.sku,
        partName: p.partName || p.name || p.sku,
        supplier: p.supplier || null,
        stockOnHand: Number(p.stockOnHand) || 0,
        reorderPoint: Number(p.reorderPoint),
        quantity: qty,
        unitCost: Number(p.unitCost) || 0,
        lineTotal: round2(qty * (Number(p.unitCost) || 0)),
      };
    })
    .sort((a, b) => a.stockOnHand - b.stockOnHand);
}

/** Group suggestions per supplier into a plain-text order the owner can send. */
export function draftOrderText(suggestions = [], { company = 'Omni' } = {}) {
  const bySupplier = new Map();
  for (const s of suggestions) {
    const key = s.supplier || 'Unassigned supplier';
    if (!bySupplier.has(key)) bySupplier.set(key, []);
    bySupplier.get(key).push(s);
  }
  return [...bySupplier.entries()].map(([supplier, lines]) => ({
    supplier,
    total: round2(lines.reduce((sum, l) => sum + l.lineTotal, 0)),
    text: [
      `Hello,`,
      ``,
      `Please send us the following parts:`,
      ...lines.map((l) => `- ${l.quantity} × ${l.partName} (SKU ${l.sku})`),
      ``,
      `Thank you,`,
      company,
    ].join('\n'),
  }));
}
