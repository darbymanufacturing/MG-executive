/**
 * briefPayload.js — the pure payload builder for the daily brief.
 *
 * Extracted from src/components/Home/DailyBrief.jsx (Autopilot Phase 4) so the
 * SERVER can build exactly the same payload for the 07:00 brief cron without
 * importing a React/JSX module. DailyBrief.jsx re-exports it, so existing
 * imports and tests are unchanged.
 */
/**
 * Pure function that builds the LLM payload from raw context data.
 * Extracted so it can be unit-tested without rendering the component.
 * @param {{ issueCtx, maintenanceCtx, projectCtx, revenueCtx, costsCtx }} contexts
 * @param {Date} now  — injectable for testing
 * @param {Object|null} metricsOverride  — pre-baked `mtd` from MetricsContext (optional).
 *   When supplied: costsThisMonth = metricsOverride.costsMTD (includes recurring active this
 *   month, not just costs dated this month — fixes #616) and revenueThisMonth =
 *   metricsOverride.revenue.operatingRevenue (NET after 19% Hopp fee + €150/mo SIM —
 *   fixes #616). Falls back to the inline raw calculation when absent (test/no-context path).
 * @returns {{ openIssuesCount, activeTicketsCount, revenueThisMonth, costsThisMonth,
 *             activeProjectsCount, fleetSize, inRepair, overdueTickets,
 *             completedToday, revenueThisWeek, revenuePrevWeek, dataIsVoid, payload }}
 */
export function buildBriefPayload(contexts, now = new Date(), metricsOverride = null) {
  const { issueCtx, maintenanceCtx, projectCtx, revenueCtx, costsCtx } = contexts;

  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const openIssuesCount = issueCtx?.activeIssues?.filter(i => i.status !== 'done').length ?? 0;
  const activeTicketsCount = maintenanceCtx?.tickets?.filter(t => t.status === 'Active').length ?? 0;

  // #616 — use MetricsContext.mtd when available:
  //   revenueThisMonth: NET operating revenue (after 19% Hopp franchise + €150/mo SIM).
  //     Gross inline fallback is the raw totalPaidRevenue sum.
  //   costsThisMonth: includes ALL active recurring costs this month, not just costs whose
  //     startDate falls in the current month (the old inline logic missed recurring costs
  //     started in prior months).
  const revenueThisMonth = metricsOverride != null
    ? (metricsOverride.revenue?.operatingRevenue ?? 0)
    : (revenueCtx?.revenueData || [])
        .filter(r => r.date?.startsWith(monthKey))
        .reduce((s, r) => s + (r.totalPaidRevenue || 0), 0);
  const costsThisMonth = metricsOverride != null
    ? (metricsOverride.costsMTD ?? 0)
    : (costsCtx?.costs || [])
        .filter(c => c.startDate?.startsWith(monthKey))
        .reduce((s, c) => s + (c.amount || 0), 0);
  const activeProjectsCount = (projectCtx?.projects || [])
    .filter(p => p.effectiveStatus !== 'archived' && !p.archived).length;
  // #558: prefer the live scooter count for the brief; fall back to the config scalar.
  const fleetSize = maintenanceCtx?.scooters?.length || costsCtx?.config?.fleetSize || 0;

  // Fix #bug-375: count scooters in repair, not Active+Backlog tickets
  const inRepair = maintenanceCtx?.scooters?.filter(s => s.status === 'In Repair').length ?? 0;

  // Fix #bug-375: compute overdue tickets (not Completed, open > 7 days)
  const overdueTickets = (maintenanceCtx?.tickets ?? [])
    .filter(t => t.status !== 'Completed' && (t.daysOpen ?? 0) > 7)
    .map(t => ({ issueDescription: t.issueDescription ?? t.title ?? '', daysOpen: t.daysOpen }));

  // Fix #bug-375: tickets completed today
  const todayDateKey = now.toISOString().slice(0, 10);
  const completedToday = (maintenanceCtx?.tickets ?? [])
    .filter(t => t.status === 'Completed' && t.dateCompleted === todayDateKey).length;

  // Fix #bug-375: compute weekly revenue buckets (use UTC midnight to be consistent
  // with ISO date strings like "2026-06-01" which parse as UTC midnight)
  const msDay = 86_400_000;
  const today0 = new Date(now);
  today0.setUTCHours(0, 0, 0, 0);
  const todayMs = today0.getTime();
  const revenueThisWeek = (revenueCtx?.revenueData ?? [])
    .filter(r => { const d = new Date(r.date).getTime(); return d >= todayMs - 6 * msDay && d <= todayMs; })
    .reduce((s, r) => s + (r.totalPaidRevenue || 0), 0);
  const revenuePrevWeek = (revenueCtx?.revenueData ?? [])
    .filter(r => { const d = new Date(r.date).getTime(); return d >= todayMs - 13 * msDay && d < todayMs - 6 * msDay; })
    .reduce((s, r) => s + (r.totalPaidRevenue || 0), 0);

  // Fix #bug-375: detect data-void state (all zeroes = pipeline stalled).
  // Autopilot Phase 4 fix: judge "no revenue" on the GROSS rows, not on
  // revenueThisMonth. Since #616 that value is NET operating revenue (after the
  // Hopp fee AND the fixed €150/mo SIM cost), so a month with zero revenue reads
  // −150, never 0 — the guard could not fire in production and the brief would
  // narrate a stalled pipeline as if it were real. Found by the server-brief tests.
  const grossRevenueThisMonth = (revenueCtx?.revenueData || [])
    .filter(r => r.date?.startsWith(monthKey))
    .reduce((s, r) => s + (r.totalPaidRevenue || 0), 0);
  const dataIsVoid = grossRevenueThisMonth === 0 && costsThisMonth === 0
    && revenueThisWeek === 0 && inRepair === 0;

  const payload = {
    openIssues:      issueCtx?.activeIssues ?? [],
    overdueTickets,
    activeTickets:   activeTicketsCount,
    completedToday,
    openProjects:    projectCtx?.activeProjects ?? [],
    revenueThisWeek,
    revenuePrevWeek,
    revenueThisMonth,
    costsThisMonth,
    criticalIssues:  issueCtx?.activeIssues?.filter(i => i.urgency === 'critical').length ?? 0,
    fleetSize,
    inRepair,
  };

  return {
    openIssuesCount, activeTicketsCount, revenueThisMonth, costsThisMonth,
    activeProjectsCount, fleetSize, inRepair, overdueTickets,
    completedToday, revenueThisWeek, revenuePrevWeek, dataIsVoid, payload,
  };
}
