/**
 * pmeAnalyses.js
 * Phase 1 analyses — all pure functions over (events, tickets, scooters).
 * No Firestore reads — all data comes from context at call time.
 * All functions are safe to call with empty arrays.
 */

import { isTrueOverturn } from './classifyEventType.js';
import { validTickets }   from './repairJunkFilter.js';

// ─── Trip counting ───────────────────────────────────────────────────────────

/**
 * Counts real completed trips by pairing trip_start → trip_end events per scooter.
 *
 * Why this beats a raw trip_start count:
 *   1. Pause/resume cycles: "Trip → Paused → Trip" creates a second trip_start for the
 *      same physical trip. Pairing ensures we only count the FIRST start before each end.
 *   2. Cancelled reservations: if the platform briefly transitions to "Trip" state before
 *      reverting to "Available" (scan-and-cancel), the pairing + MIN_TRIP_SECS threshold
 *      excludes those artefacts.
 *
 * Events that went RESERVED → AVAILABLE (no trip_start emitted at all) are already
 * excluded upstream by the eventType classifier, so they never reach this function.
 *
 * @param {object[]} events  - flat array of telemetry events (may span multiple scooters)
 * @param {number}   minSecs - minimum trip duration in seconds; shorter = cancelled artefact
 * @returns {number}
 */
const MIN_TRIP_SECS = 30;

const isTripState   = (s) => s === 'trip' || s === 'on trip';
const isPausedState = (s) => s === 'paused' || s === 'trip paused' || s === 'pause';

/**
 * Counts real completed trips by tracking raw state transitions rather than
 * eventType. This is essential because:
 *   - "Trip → Overturned" classifies as 'overturned' (not trip_end), so relying
 *     on trip_end events would miss trips that ended when the rider fell.
 *   - "Trip → Maintenance" or other non-resting exits also need to count as
 *     trip completion.
 *
 * Rule: a trip STARTS when we enter Trip state from a non-trip/non-paused
 * state, and ENDS when we leave Trip/Paused to any state that isn't Trip/Paused.
 */
export function countRealTrips(events, minSecs = MIN_TRIP_SECS) {
  const byScooter = {};
  for (const ev of events) {
    if (!byScooter[ev.scooterId]) byScooter[ev.scooterId] = [];
    byScooter[ev.scooterId].push(ev);
  }

  let total = 0;
  for (const evs of Object.values(byScooter)) {
    const sorted = [...evs]
      .filter((e) => e.timestamp != null)
      .sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''));
    let tripStart = null;
    for (const ev of sorted) {
      const before = (ev.beforeState || '').trim().toLowerCase();
      const after  = (ev.afterState  || '').trim().toLowerCase();

      // Enter trip: transition from a non-trip/non-paused state INTO trip
      if (isTripState(after) && !isTripState(before) && !isPausedState(before)) {
        if (!tripStart) tripStart = ev;
      }
      // Exit trip: leaving Trip/Paused to any non-trip/non-paused state
      else if (tripStart &&
               (isTripState(before) || isPausedState(before)) &&
               !isTripState(after) && !isPausedState(after)) {
        const secs = (new Date(ev.timestamp) - new Date(tripStart.timestamp)) / 1000;
        if (secs >= minSecs) total++;
        tripStart = null;
      }
    }
  }
  return total;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function daysBetween(a, b) {
  return (new Date(b) - new Date(a)) / 86_400_000;
}

function _addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function _stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// ─── 1. Overturn → Repair Correlation ───────────────────────────────────────

/**
 * For each scooter: count true overturns in each 30-day window,
 * then count repairs in that window + lagDays ahead.
 * Returns { pearsonR, perScooter: [{ scooterId, overturns, repairs, ratio }] }
 */
export function overturnToRepairCorrelation(events, tickets, _lagDays = 30) {
  const trueOvt     = events.filter(isTrueOverturn);
  const goodTickets = validTickets(tickets);
  const scooterIds  = [...new Set([
    ...trueOvt.map((e) => e.scooterId),
    ...goodTickets.map((t) => t.scooterId),
  ])];

  const perScooter = scooterIds.map((id) => {
    const ovts    = trueOvt.filter((e) => e.scooterId === id);
    const repairs = goodTickets.filter((t) => t.scooterId === id);
    return { scooterId: id, overturns: ovts.length, repairs: repairs.length };
  });

  // Pearson r between overturn count and repair count across all scooters
  const xs = perScooter.map((d) => d.overturns);
  const ys = perScooter.map((d) => d.repairs);
  const mx = mean(xs), my = mean(ys);
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const den = Math.sqrt(
    xs.reduce((s, x) => s + (x - mx) ** 2, 0) *
    ys.reduce((s, y) => s + (y - my) ** 2, 0),
  );
  const pearsonR = den === 0 ? 0 : num / den;

  return { pearsonR: +pearsonR.toFixed(3), perScooter };
}

// ─── 2. True Overturn Detection ──────────────────────────────────────────────

/**
 * Returns only events that are genuine overturns (not during rebalance/transport).
 * Grouped by scooterId with total count and last-30-day count.
 */
export function trueOverturnsReport(events) {
  const trueOvt = events.filter(isTrueOverturn);
  const _now    = new Date().toISOString();
  const cutoff  = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const byScooter = {};
  for (const ev of trueOvt) {
    if (!byScooter[ev.scooterId]) {
      byScooter[ev.scooterId] = { total: 0, last30: 0, events: [] };
    }
    byScooter[ev.scooterId].total++;
    if (ev.timestamp >= cutoff) byScooter[ev.scooterId].last30++;
    byScooter[ev.scooterId].events.push(ev);
  }

  return Object.entries(byScooter).map(([scooterId, d]) => ({
    scooterId, ...d,
  })).sort((a, b) => b.total - a.total);
}

// ─── 3. Repair Junk Filtering ─────────────────────────────────────────────

// Re-exported from repairJunkFilter.js — available via pmeAnalyses for convenience
export { validTickets, annotateTicketValidity } from './repairJunkFilter.js';

// ─── 4. Downtime by Cause ────────────────────────────────────────────────────

const DOWNTIME_AFTER_STATES = {
  rebalance_start:  'rebalance',
  maintenance_start:'maintenance',
  low_battery:      'low_battery',
  removed:          'removed',
};

/**
 * For each scooter, finds intervals where a downtime eventType starts (e.g. rebalance_start)
 * and a subsequent event ends it. Sums hours grouped by cause.
 * Returns { byScooter, byCause, totalHours }
 */
export function downtimeByCause(events) {
  // Sort all events chronologically per scooter
  const byScooter = {};
  for (const ev of events) {
    if (!byScooter[ev.scooterId]) byScooter[ev.scooterId] = [];
    byScooter[ev.scooterId].push(ev);
  }

  const byCause   = { rebalance: 0, maintenance: 0, low_battery: 0, removed: 0 };
  const scooterDowntime = {};

  for (const [scooterId, evs] of Object.entries(byScooter)) {
    const sorted = [...evs]
      .filter((e) => e.timestamp != null)
      .sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''));
    let inDowntime = null;
    let cause      = null;
    let total      = 0;

    for (const ev of sorted) {
      if (!inDowntime && DOWNTIME_AFTER_STATES[ev.eventType]) {
        inDowntime = ev.timestamp;
        cause      = DOWNTIME_AFTER_STATES[ev.eventType];
      } else if (inDowntime && ev.eventType !== 'other') {
        const hrs = daysBetween(inDowntime, ev.timestamp) * 24;
        if (hrs > 0 && hrs < 720) { // ignore intervals > 30 days (data gap)
          byCause[cause] = (byCause[cause] || 0) + hrs;
          total += hrs;
        }
        inDowntime = null;
        cause      = null;
      }
    }
    scooterDowntime[scooterId] = total;
  }

  const totalHours = Object.values(byCause).reduce((s, v) => s + v, 0);
  return { byScooter: scooterDowntime, byCause, totalHours };
}

// ─── 5. Per-Scooter Overturn Baseline ────────────────────────────────────────

/**
 * For a given scooter: compute lifetime mean overturn rate (per day) vs last 30 days.
 * Returns { lifetimeMean, last30Rate, ratio, anomaly (ratio > 2) }
 */
export function overturnBaseline(events, scooterId, windowDays = 30) {
  const trueOvt = events.filter((e) => e.scooterId === scooterId && isTrueOverturn(e));
  if (!trueOvt.length) return { lifetimeMean: 0, last30Rate: 0, ratio: 1, anomaly: false };

  // Sort by date to find lifetime span (filter nulls first to avoid TypeError)
  const sorted  = [...trueOvt]
    .filter((e) => e.timestamp != null)
    .sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''));
  // Use only the null-filtered set for all calculations so null-ts events are excluded.
  if (!sorted.length) return { lifetimeMean: 0, last30Rate: 0, ratio: 1, anomaly: false };
  const firstEv = sorted[0].timestamp;
  const _lastEv = sorted[sorted.length - 1].timestamp;
  const lifetimeDays = Math.max(1, daysBetween(firstEv, new Date().toISOString()));

  // #628 — require at least 3 events AND 14 days of history before the ratio is
  // statistically meaningful. A scooter with 1–2 lifetime events or < 2 weeks of
  // data can produce extreme ratios from a single incident; return neutral values.
  if (sorted.length < 3 || lifetimeDays < 14) {
    const cutoffEarly = new Date(Date.now() - windowDays * 86_400_000).toISOString();
    const last30Early = sorted.filter((e) => e.timestamp >= cutoffEarly);
    return {
      lifetimeMean: 0,
      last30Rate:   0,
      ratio:        1,
      anomaly:      false,
      last30Count:  last30Early.length,
      totalCount:   sorted.length,
    };
  }

  const lifetimeMean = sorted.length / lifetimeDays; // per day (null-ts events excluded)

  const cutoff = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const last30 = sorted.filter((e) => e.timestamp >= cutoff);
  const last30Rate = last30.length / windowDays;

  const ratio   = lifetimeMean > 0 ? last30Rate / lifetimeMean : 1;
  const anomaly = ratio > 2;

  return {
    lifetimeMean: +lifetimeMean.toFixed(4),
    last30Rate:   +last30Rate.toFixed(4),
    ratio:        +ratio.toFixed(2),
    anomaly,
    last30Count:  last30.length,
    totalCount:   sorted.length, // null-ts events excluded from count
  };
}

// ─── 6. Fleet Risk Ranking ────────────────────────────────────────────────────

/**
 * Composite risk score per scooter.
 * Score = 0.5 × normalised_overturn_ratio
 *       + 0.3 × normalised_recent_repairs
 *       + 0.2 × normalised_days_since_last_service
 *
 * Returns sorted array (highest risk first) with risk badge.
 */
export function fleetRiskRanking(events, tickets, scooters) {
  const goodTickets = validTickets(tickets);
  const now         = new Date().toISOString();
  const cutoff30    = new Date(Date.now() - 30 * 86_400_000).toISOString();

  // #594 — exclude Donor/Retired scooters from the Maintenance Priority Queue
  const operationalScooters = scooters.filter((s) => !['Donor', 'Retired'].includes(s.status));

  const scored = operationalScooters.map((sc) => {
    const id = sc.scooterId;

    // Overturn ratio (last 30d vs lifetime baseline)
    const { ratio: overturnRatio, anomaly } = overturnBaseline(events, id);

    // Recent repairs (last 30 days)
    const recentRepairs = goodTickets.filter(
      (t) => t.scooterId === id && t.dateEntered >= cutoff30.slice(0, 10),
    ).length;

    // Days since last service — no fallback to purchaseDate (purchase date ≠ service date;
    // using it caused all scooters with purchase date >180 days ago to hit the 180-cap,
    // showing an artificial '180' in the table). Score 0 (neutral) when no service history.
    const allRepairs = goodTickets.filter((t) => t.scooterId === id);
    const lastService = allRepairs.reduce((latest, t) => {
      const d = t.dateCompleted || t.dateEntered;
      return d > latest ? d : latest;
    }, '');
    const daysSinceService = lastService
      ? daysBetween(lastService, now.slice(0, 10))
      : 0; // neutral when no service history

    return {
      scooterId:      id,
      city:           sc.city,
      model:          sc.model,
      status:         sc.status,
      overturnRatio:  Math.min(overturnRatio, 5),   // cap at 5×
      recentRepairs,
      daysSinceService: Math.min(daysSinceService, 180), // cap at 180d
      anomaly,
    };
  });

  // Normalise each dimension (0–1) — use reduce to avoid spread blow-up at large fleet sizes
  const maxOR  = scored.reduce((m, s) => Math.max(m, s.overturnRatio), 1);
  const maxRR  = scored.reduce((m, s) => Math.max(m, s.recentRepairs), 1);
  const maxDS  = scored.reduce((m, s) => Math.max(m, s.daysSinceService), 1);

  const ranked = scored.map((s) => {
    const normOR  = s.overturnRatio   / maxOR;
    const normRR  = s.recentRepairs   / maxRR;
    const normDS  = s.daysSinceService / maxDS;
    const score   = clamp(0.5 * normOR + 0.3 * normRR + 0.2 * normDS, 0, 1);

    let risk;
    if (score >= 0.65)     risk = 'high';
    else if (score >= 0.35) risk = 'medium';
    else                    risk = 'low';

    return { ...s, score: +score.toFixed(3), risk };
  }).sort((a, b) => b.score - a.score);

  return ranked;
}

// ─── 7. Fleet KPIs ───────────────────────────────────────────────────────────

/**
 * Fleet-wide summary KPIs from events + tickets.
 */
export function fleetKpis(events, tickets, scooters) {
  const good    = validTickets(tickets);
  const active  = scooters.filter((s) => s.status === 'Active').length;
  const total   = scooters.length;

  const trips   = countRealTrips(events);
  const dt      = downtimeByCause(events);
  const ovts    = events.filter(isTrueOverturn).length;

  // Utilisation: active scooters not currently in downtime (approximation)
  const utilPct = total > 0 ? Math.round((active / total) * 100) : 0;

  return {
    totalScooters:   total,
    activeScooters:  active,
    totalTrips:      trips,
    totalDowntimeHrs: +dt.totalHours.toFixed(1),
    downtimeByCause: dt.byCause,
    trueOverturns:   ovts,
    overturnRate:    trips > 0 ? +(ovts / trips * 100).toFixed(2) : 0,
    totalRepairs:    good.length,
    utilisationPct:  utilPct,
  };
}

// ─── 8. Weekly Digest ─────────────────────────────────────────────────────────

/**
 * Events and repairs from the last 7 days vs the 7 days before that.
 */
export function weeklyDigest(events, tickets) {
  const good    = validTickets(tickets);
  const now     = Date.now();
  const w1Start = new Date(now - 7  * 86_400_000).toISOString();
  const w2Start = new Date(now - 14 * 86_400_000).toISOString();

  const thisWeekEvents = events.filter((e) => e.timestamp >= w1Start);
  const lastWeekEvents = events.filter((e) => e.timestamp >= w2Start && e.timestamp < w1Start);

  const thisWeek = {
    trips:        countRealTrips(thisWeekEvents),
    overturns:    thisWeekEvents.filter(isTrueOverturn).length,
    repairs:      good.filter((t) => t.dateEntered >= w1Start.slice(0, 10)).length,
    newAnomalies: [], // filled below
  };
  const lastWeek = {
    trips:     countRealTrips(lastWeekEvents),
    overturns: lastWeekEvents.filter(isTrueOverturn).length,
    repairs:   good.filter((t) => t.dateEntered >= w2Start.slice(0, 10) && t.dateEntered < w1Start.slice(0, 10)).length,
  };

  return { thisWeek, lastWeek };
}
