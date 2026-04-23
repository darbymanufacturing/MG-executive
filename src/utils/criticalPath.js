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

  // ── Forward pass ─────────────────────────────────────────────────────────
  const ES = {};
  const EF = {};

  for (const ph of phases) {
    const preds = predecessors[ph.id] || [];
    ES[ph.id] = preds.length > 0
      ? Math.max(...preds.map((pid) => EF[pid] ?? 0))
      : 0;
    EF[ph.id] = ES[ph.id] + getDuration(ph);
  }

  const projectDuration = Math.max(...Object.values(EF));

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
 */
export function dayOffsetToDate(isoStart, dayOffset) {
  const d = new Date(isoStart);
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString().slice(0, 10);
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
  return days > 0 ? days : DEFAULT_DURATION;
}
