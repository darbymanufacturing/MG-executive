/**
 * Pure calculation helpers for the Investment Tracker module.
 * All functions are side-effect-free and accept plain JS objects.
 * Use useMemo() in components to avoid recomputing on every render.
 */

/**
 * Project month-by-month cumulative P&L from investment start.
 * Returns an array of { month (1-based), label, cumulative, revenue, opex } objects.
 *
 * @param {object} params
 * @param {number} params.investment     - Total initial investment (€)
 * @param {number} params.horizonMonths  - Number of months to project
 * @param {number} params.monthlyRevenue - Net monthly revenue (after Hopp/SIM deductions)
 * @param {number} params.monthlyOpex    - Monthly operating costs (excl. investment)
 * @returns {{ month: number, label: string, cumulative: number, revenue: number, opex: number }[]}
 */
export function projectCumulativePnL({ investment, horizonMonths, monthlyRevenue, monthlyOpex }) {
  const result = [];
  let cumulative = -investment; // starts negative (capital outlay)
  const monthlyProfit = monthlyRevenue - monthlyOpex;

  for (let i = 1; i <= horizonMonths; i++) {
    cumulative += monthlyProfit;
    result.push({
      month: i,
      label: `M${i}`,
      cumulative: parseFloat(cumulative.toFixed(2)),
      revenue: parseFloat(monthlyRevenue.toFixed(2)),
      opex: parseFloat(monthlyOpex.toFixed(2)),
    });
  }
  return result;
}

/**
 * Find the break-even month from a cumulative P&L series.
 * Returns the month number or null if never breaks even in the horizon.
 *
 * @param {{ cumulative: number, month: number }[]} pnlSeries
 * @returns {number|null}
 */
export function findBreakEvenMonth(pnlSeries) {
  const entry = pnlSeries.find((p) => p.cumulative >= 0);
  return entry ? entry.month : null;
}

/**
 * Estimate lifetime net revenue attributed to a single scooter.
 *
 * Revenue attribution: for each daily revenue row, the scooter "earns"
 * (totalPaidRevenue / activeScootersOnDay) on days it was NOT in repair.
 *
 * "In repair" periods are derived from maintenanceTickets for this scooterId:
 * any day between ticket.dateEntered and ticket.dateCompleted (or today for open tickets)
 * is treated as a down day.
 *
 * @param {object}   scooter          - scooters doc { scooterId, purchaseDate, ... }
 * @param {object[]} revenueRows      - all rows from RevenueContext (each has date, totalPaidRevenue, uniqueVehiclesCount?)
 * @param {object[]} tickets          - maintenanceTickets for this scooterId
 * @param {object|null} financial     - config.financial (franchise rate, SIM cost). Pass null to skip adjustments.
 * @param {number}  [defaultFleetSize=1] - fallback fleet size when row has no uniqueVehiclesCount
 * @returns {{ total: number, monthly: { key: string, revenue: number }[] }}
 */
export function revenuePerScooterLifetime(scooter, revenueRows, tickets, financial, defaultFleetSize = 1) {
  if (!scooter || !revenueRows?.length) return { total: 0, monthly: [] };

  // Build a Set of "in repair" date strings for this scooter
  const repairDays = new Set();
  (tickets || []).forEach((t) => {
    if (!t.dateEntered) return;
    const start = new Date(t.dateEntered + 'T12:00:00Z');
    const end = t.dateCompleted
      ? new Date(t.dateCompleted + 'T12:00:00Z')
      : new Date();
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      repairDays.add(d.toISOString().slice(0, 10));
    }
  });

  // Only count days after the scooter's purchaseDate
  const purchaseCutoff = scooter.purchaseDate
    ? new Date(scooter.purchaseDate + 'T00:00:00Z')
    : null;

  // Apply financial adjustments (franchise rate + SIM deduction)
  const fin = financial
    ? { applyFranchiseFee: true, franchiseRate: 0.19, monthlySimCost: 150, ...financial }
    : null;

  const monthlyMap = {};

  revenueRows.forEach((row) => {
    if (!row.date || !row.totalPaidRevenue) return;
    if (purchaseCutoff && new Date(row.date + 'T12:00:00Z') < purchaseCutoff) return;
    if (repairDays.has(row.date)) return; // scooter was down

    // Use uniqueVehiclesCount (from CSV import) or fallback to config fleetSize
    const activeOnDay = row.uniqueVehiclesCount || row.activeScooters || defaultFleetSize || 1;
    let daily = row.totalPaidRevenue / activeOnDay;

    // Apply franchise fee if enabled
    if (fin?.applyFranchiseFee && fin.franchiseRate > 0) {
      daily = daily * (1 - fin.franchiseRate);
    }

    // Monthly key for grouping
    const key = row.date.slice(0, 7); // YYYY-MM
    monthlyMap[key] = (monthlyMap[key] || 0) + daily;
  });

  // Deduct monthly SIM cost proportionally (÷ fleet size is approximate)
  // We skip per-scooter SIM deduction as it's already fleet-level — leave as-is
  // (matching the approach in financialHealth.js which deducts it fleet-wide)

  const monthly = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, revenue]) => ({ key, revenue: parseFloat(revenue.toFixed(2)) }));

  const total = monthly.reduce((s, m) => s + m.revenue, 0);
  return { total: parseFloat(total.toFixed(2)), monthly };
}

/**
 * Compute total and monthly repair cost for a scooter.
 *
 * Repair cost = sum of (part.quantity × maintenanceParts[partId].unitCost)
 * across all tickets for this scooter. Labour from labourMinutes if config provides a rate.
 *
 * @param {string}   scooterId      - The scooter identifier
 * @param {object[]} tickets        - All maintenanceTickets docs (pre-filtered or full set)
 * @param {object[]} parts          - maintenanceParts collection docs
 * @param {number}   [labourRatePerHour=0] - Optional hourly labour rate (€/h)
 * @returns {{ total: number, monthly: { key: string, cost: number }[], byTicket: object[] }}
 */
export function repairCostPerScooter(scooterId, tickets, parts, labourRatePerHour = 0) {
  const myTickets = (tickets || []).filter(
    (t) => String(t.scooterId) === String(scooterId),
  );

  // Build partId → unitCost lookup
  const partCostMap = {};
  (parts || []).forEach((p) => {
    partCostMap[p._docId] = p.unitCost || 0;
    partCostMap[p.partId] = p.unitCost || 0; // support both key styles
    if (p.sku) partCostMap[p.sku] = p.unitCost || 0;
  });

  const monthlyMap = {};
  const byTicket = [];

  myTickets.forEach((t) => {
    let partsCost = 0;
    (t.partsUsed || []).forEach((pu) => {
      const unitCost = pu.unitCost ?? partCostMap[pu.partId] ?? partCostMap[pu._docId] ?? 0;
      partsCost += (pu.quantity || 0) * unitCost;
    });

    const labourCost = labourRatePerHour > 0 && t.labourMinutes
      ? (t.labourMinutes / 60) * labourRatePerHour
      : 0;

    const ticketTotal = partsCost + labourCost;
    const key = (t.dateEntered || t.dateCompleted || '').slice(0, 7); // YYYY-MM

    if (key) {
      monthlyMap[key] = (monthlyMap[key] || 0) + ticketTotal;
    }

    byTicket.push({
      _docId: t._docId,
      dateEntered: t.dateEntered,
      dateCompleted: t.dateCompleted,
      category: t.category,
      status: t.status,
      daysOpen: t.daysOpen || 0,
      revenueLost: t.revenueLost || 0,
      partsCost: parseFloat(partsCost.toFixed(2)),
      labourCost: parseFloat(labourCost.toFixed(2)),
      total: parseFloat(ticketTotal.toFixed(2)),
    });
  });

  const monthly = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, cost]) => ({ key, cost: parseFloat(cost.toFixed(2)) }));

  const total = monthly.reduce((s, m) => s + m.cost, 0);
  return { total: parseFloat(total.toFixed(2)), monthly, byTicket };
}

/**
 * Build one row for the Scooter Ledger table.
 * Composes revenuePerScooterLifetime + repairCostPerScooter into a single object.
 *
 * @param {object}   scooter       - scooters doc
 * @param {object[]} revenueRows   - all revenue rows
 * @param {object[]} allTickets    - all maintenanceTickets
 * @param {object[]} parts         - maintenanceParts
 * @param {object|null} financial  - config.financial
 * @param {number}   [labourRate=0]
 * @param {number}   [defaultFleetSize=1]
 * @returns {object}
 */
/**
 * @param {object|null} tripRevenueOverride  - When trip-level data exists, pass
 *   { total: number, monthly: { key: string, revenue: number }[] } here.
 *   When provided this is used instead of the fleet-attribution formula.
 */
export function scooterLedgerRow(scooter, revenueRows, allTickets, parts, financial, labourRate = 0, defaultFleetSize = 1, tripRevenueOverride = null) {
  const myTickets = (allTickets || []).filter(
    (t) => String(t.scooterId) === String(scooter.scooterId),
  );

  // Prefer exact trip-level revenue when available; fall back to fleet attribution
  const { total: revenueTotal, monthly: revenueMonthly } = tripRevenueOverride
    ? tripRevenueOverride
    : revenuePerScooterLifetime(scooter, revenueRows, myTickets, financial, defaultFleetSize);

  const { total: repairTotal, monthly: repairMonthly, byTicket } =
    repairCostPerScooter(scooter.scooterId, myTickets, parts, labourRate);

  const purchasePrice = scooter.purchasePrice != null ? Number(scooter.purchasePrice) : null;

  // Months in service since purchaseDate
  let monthsInService = null;
  if (scooter.purchaseDate) {
    const purchase = new Date(scooter.purchaseDate + 'T12:00:00Z');
    const now = new Date();
    monthsInService = Math.max(0,
      (now.getFullYear() - purchase.getFullYear()) * 12 +
      (now.getMonth() - purchase.getMonth()),
    );
  }

  // Straight-line depreciation: scooter depreciates over 60 months (5 years).
  // depreciatedCost = purchasePrice × min(monthsInService, 60) / 60
  // When purchaseDate is unknown we fall back to the full purchase price (conservative).
  const DEPRECIATION_MONTHS = 60;
  const depreciatedCost =
    purchasePrice != null && monthsInService != null
      ? parseFloat((purchasePrice * (Math.min(monthsInService, DEPRECIATION_MONTHS) / DEPRECIATION_MONTHS)).toFixed(2))
      : (purchasePrice || 0);

  // Book P&L: revenue minus depreciated purchase cost + repairs (shown as Net Position)
  const totalCost = parseFloat((depreciatedCost + repairTotal).toFixed(2));
  const netPosition = parseFloat((revenueTotal - totalCost).toFixed(2));

  // Cash P&L: revenue minus full purchase price + repairs (useful for payback tracking)
  const cashTotalCost = parseFloat(((purchasePrice || 0) + repairTotal).toFixed(2));
  const cashPnl = parseFloat((revenueTotal - cashTotalCost).toFixed(2));

  // paybackPct based on depreciated cost basis (positive = scooter is earning above its current book cost)
  const paybackPct = purchasePrice
    ? parseFloat(((netPosition / purchasePrice) * 100).toFixed(1))
    : null;

  return {
    ...scooter,
    revenueTotal:    parseFloat(revenueTotal.toFixed(2)),
    repairTotal:     parseFloat(repairTotal.toFixed(2)),
    depreciatedCost,
    totalCost,
    netPosition,
    cashPnl,
    paybackPct,
    monthsInService,
    revenueMonthly,
    repairMonthly,
    byTicket,
  };
}
