/**
 * Critical Path Method (CPM) calculator.
 *
 * Each phase must have: id, name, duration (days), dependencies (phase IDs),
 * parallel (bool), number. Unknown durations default to 7 days.
 *
 * Dependency rules (in priority order):
 *  1. Explicit phase.dependencies[] — list of predecessor phase IDs
 *  2. If empty and index > 0 and !parallel → previous phase is predecessor
 *  3. If parallel=true and no explicit deps → shares predecessor of prev phase
 */

const DEFAULT_DURATION = 7;

function getDuration(phase) {
  return phase.duration && phase.duration > 0 ? Number(phase.duration) : DEFAULT_DURATION;
}

/**
 * Build predecessor map from phase list.
 * Returns { [phaseId]: string[] } of predecessor IDs.
 */
function buildPredecessors(phases) {
  const map = {};
  for (let i = 0; i < phases.length; i++) {
    const ph = phases[i];
    const explicit = (ph.dependencies || []).filter((id) =>
      phases.some((p) => p.id === id),
    );

    if (explicit.length > 0) {
      map[ph.id] = explicit;
    } else if (i === 0) {
      map[ph.id] = [];
    } else if (ph.parallel) {
      // Parallel phase shares same predecessors as the phase before it
      map[ph.id] = [...(map[phases[i - 1].id] || [])];
    } else {
      map[ph.id] = [phases[i - 1].id];
    }
  }
  return map;
}

/**
 * Compute CPM for a list of phases.
 * Returns enriched phase objects with ES, EF, LS, LF, float, critical.
 */
export function computeCPM(phases) {
  if (!phases || phases.length === 0) return [];

  const predecessors = buildPredecessors(phases);

  // ── Topological sort (BFS/Kahn) to handle non-ordered input ─────────────
  // Build successor map
  const succMap = {};
  for (const ph of phases) succMap[ph.id] = [];
  for (const ph of phases) {
    for (const pid of predecessors[ph.id] || []) {
      if (succMap[pid]) succMap[pid].push(ph.id);
    }
  }
  const topoQueue = phases.filter((ph) => (predecessors[ph.id] || []).length === 0).map((ph) => ph.id);
  const topoOrder = [];
  const visited = new Set();
  while (topoQueue.length > 0) {
    const id = topoQueue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    topoOrder.push(id);
    for (const sid of succMap[id] || []) {
      if (!visited.has(sid)) topoQueue.push(sid);
    }
  }
  // If cycle detected (not all phases visited), fall back to original order
  const orderedPhases = topoOrder.length === phases.length
    ? topoOrder.map((id) => phases.find((ph) => ph.id === id))
    : phases;

  // ── Forward pass ─────────────────────────────────────────────────────────
  const ES = {};
  const EF = {};

  for (const ph of orderedPhases) {
    const preds = predecessors[ph.id] || [];
    ES[ph.id] = preds.length > 0
      ? preds.reduce((m, pid) => Math.max(m, EF[pid] ?? 0), 0)
      : 0;
    EF[ph.id] = ES[ph.id] + getDuration(ph);
  }

  const projectDuration = Object.keys(EF).length
    ? Object.values(EF).reduce((m, v) => Math.max(m, v), 0)
    : 0;

  // ── Build successor map ───────────────────────────────────────────────────
  const successors = {};
  for (const ph of phases) successors[ph.id] = [];
  for (const ph of phases) {
    for (const pid of predecessors[ph.id] || []) {
      if (successors[pid]) successors[pid].push(ph.id);
    }
  }

  // ── Backward pass ─────────────────────────────────────────────────────────
  const LS = {};
  const LF = {};

  for (const ph of [...phases].reverse()) {
    const succs = successors[ph.id] || [];
    LF[ph.id] = succs.length > 0
      ? Math.min(...succs.map((sid) => LS[sid] ?? projectDuration))
      : projectDuration;
    LS[ph.id] = LF[ph.id] - getDuration(ph);
  }

  // ── Float + critical flag ─────────────────────────────────────────────────
  return phases.map((ph) => {
    const float = Math.round((LS[ph.id] - ES[ph.id]) * 100) / 100;
    return {
      ...ph,
      duration:     getDuration(ph),
      ES:           ES[ph.id],
      EF:           EF[ph.id],
      LS:           LS[ph.id],
      LF:           LF[ph.id],
      float,
      critical:     float <= 0,
      predecessors: predecessors[ph.id],
    };
  });
}

/**
 * Return only the phases on the critical path (float === 0), in order.
 */
export function getCriticalPath(cpmResult) {
  return cpmResult.filter((ph) => ph.critical);
}

/**
 * Total project duration in days (max EF across all phases).
 */
export function getProjectDuration(cpmResult) {
  if (!cpmResult.length) return 0;
  return Math.max(...cpmResult.map((ph) => ph.EF));
}

/**
 * Convert a CPM day-offset to a calendar date, starting from a given ISO date string.
 * Uses date-only integer arithmetic to avoid DST skew.
 */
export function dayOffsetToDate(isoStart, dayOffset) {
  // Parse YYYY-MM-DD components directly — no Date object for arithmetic
  const [y, m, dd] = isoStart.slice(0, 10).split('-').map(Number);
  // Use a noon UTC anchor only for the initial parse, then do integer day math
  const base = new Date(Date.UTC(y, m - 1, dd));
  const result = new Date(base.getTime() + dayOffset * 86400000);
  const ry = result.getUTCFullYear();
  const rm = result.getUTCMonth() + 1;
  const rd = result.getUTCDate();
  return `${ry}-${String(rm).padStart(2,'0')}-${String(rd).padStart(2,'0')}`;
}

/**
 * Derive a phase's duration from its targetDate and the project's startDate.
 * Falls back to DEFAULT_DURATION if dates are missing or invalid.
 */
export function deriveDurationFromDates(projectStartDate, phaseTargetDate) {
  if (!projectStartDate || !phaseTargetDate) return DEFAULT_DURATION;
  const start  = new Date(projectStartDate);
  const target = new Date(phaseTargetDate);
  const days   = Math.round((target - start) / 86400000);
  return days >= 0 ? Math.max(1, days) : DEFAULT_DURATION;
}
