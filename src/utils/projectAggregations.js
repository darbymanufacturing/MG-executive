/**
 * Shared aggregation helpers for Projects module.
 * Used by Checklist, Calendar, Timeline, and PortfolioOverview.
 */

/** Flatten all phase tasks across all projects, attaching project + phase context. */
export function flattenTasks(projects) {
  const tasks = [];
  for (const project of projects) {
    for (const phase of project.phases || []) {
      for (const task of phase.tasks || []) {
        tasks.push({
          ...task,
          assignee: task.assignee || null,
          projectId: project._docId,
          projectName: project.name,
          projectOwner: project.owner,
          projectStatus: project.effectiveStatus,
          phaseId: phase.id,
          phaseName: phase.name,
          phaseNumber: phase.number,
          phaseStatus: phase.status,
          phaseTargetDate: phase.targetDate || null,
        });
      }
    }
  }
  return tasks;
}

/** Count open tasks per assignee (null → 'Unassigned'). */
export function tasksByAssignee(projects) {
  const counts = {};
  const tasks = flattenTasks(projects);
  for (const t of tasks) {
    if (t.done) continue;
    const key = t.assignee || 'Unassigned';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/** Collect all calendar events from projects as a flat list. */
export function collectCalendarEvents(projects) {
  const events = [];
  for (const project of projects) {
    if (project.archived) continue;

    // Phase target dates
    for (const phase of project.phases || []) {
      if (phase.targetDate) {
        events.push({
          type: 'phaseTarget',
          date: phase.targetDate,
          label: phase.name,
          subLabel: project.name,
          projectId: project._docId,
          phaseId: phase.id,
          status: phase.status,
          owner: project.owner,
        });
      }
      if (phase.actualDate) {
        events.push({
          type: 'phaseActual',
          date: phase.actualDate,
          label: `✓ ${phase.name}`,
          subLabel: project.name,
          projectId: project._docId,
          phaseId: phase.id,
          status: 'done',
          owner: project.owner,
        });
      }
    }

    // Next action due date
    if (project.nextAction?.dueDate) {
      events.push({
        type: 'nextAction',
        date: project.nextAction.dueDate,
        label: project.nextAction.text || 'Next action',
        subLabel: project.name,
        projectId: project._docId,
        owner: project.owner,
      });
    }

    // Active blockers
    for (const b of project.blockers || []) {
      if (!b.resolved && b.addedAt) {
        events.push({
          type: 'blocker',
          date: b.addedAt,
          label: b.text,
          subLabel: project.name,
          projectId: project._docId,
          blockerType: b.type,
          owner: project.owner,
        });
      }
    }

    // Decisions
    for (const d of project.decisions || []) {
      if (d.date) {
        events.push({
          type: 'decision',
          date: d.date,
          label: d.title || d.decision?.slice(0, 50) || 'Decision',
          subLabel: project.name,
          projectId: project._docId,
          owner: project.owner,
        });
      }
    }

    // POW entries (weekOf = Monday date)
    for (const pow of project.powEntries || []) {
      if (pow.weekOf) {
        events.push({
          type: 'pow',
          date: pow.weekOf,
          label: pow.focusNext || 'POW entry',
          subLabel: project.name,
          projectId: project._docId,
          owner: pow.loggedBy || project.owner,
        });
      }
    }
  }
  return events;
}

/** Group events by date string (YYYY-MM-DD). */
export function groupEventsByDate(events) {
  const map = {};
  for (const ev of events) {
    if (!ev.date) continue;
    const key = ev.date.slice(0, 10);
    if (!map[key]) map[key] = [];
    map[key].push(ev);
  }
  return map;
}

/** Upcoming deadlines: phase targets + nextAction dueDates within next N days. */
export function upcomingDeadlines(projects, days = 14) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + days);

  const deadlines = [];
  for (const p of projects) {
    if (p.archived) continue;
    for (const phase of p.phases || []) {
      if (phase.targetDate && phase.status !== 'done') {
        const d = new Date(phase.targetDate);
        if (d >= today && d <= cutoff) {
          deadlines.push({ date: phase.targetDate, label: phase.name, subLabel: p.name, projectId: p._docId, type: 'phaseTarget' });
        }
      }
    }
    if (p.nextAction?.dueDate) {
      const d = new Date(p.nextAction.dueDate);
      if (d >= today && d <= cutoff) {
        deadlines.push({ date: p.nextAction.dueDate, label: p.nextAction.text || 'Next action', subLabel: p.name, projectId: p._docId, type: 'nextAction' });
      }
    }
  }
  return deadlines.sort((a, b) => a.date.localeCompare(b.date));
}

/** Build weeks array for calendar month view. Each week = array of 7 day objects. */
export function buildMonthWeeks(year, month) {
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  // Start grid on Monday
  const startOffset = (firstDay.getDay() + 6) % 7;
  const days = [];
  for (let i = -startOffset; i < lastDay.getDate(); i++) {
    const d = new Date(year, month, i + 1);
    days.push(d);
  }
  // Pad to full weeks
  while (days.length % 7 !== 0) {
    const last = days[days.length - 1];
    days.push(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
  }
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return weeks;
}

/** ISO date string from a Date object. */
export function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

/** Color token per calendar event type. */
export const EVENT_COLORS = {
  phaseTarget: '#C97D49',
  phaseActual: '#00C896',
  nextAction:  '#A0521D',
  blocker:     '#E84545',
  decision:    '#6B7280',
  pow:         '#3B82F6',
};
