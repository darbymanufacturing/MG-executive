/**
 * powSummary.js — the Monday POW recap, drafted automatically.
 * Autopilot Phase 4 (docs/AUTOMATION_PLAN.md: "A Monday summary (done / moved /
 * blocked) is drafted for your approval").
 *
 * POW v3 tasks carry: status ('backlog' | 'pow' | 'done'), doneWeek, createdWeek,
 * and powWeeks {person → week they were pulled into POW}. From that alone we can
 * say, for any finished week W:
 *   - done      — completed in W
 *   - carried   — pulled into POW for W but still not done (moves to this week)
 *   - added     — new backlog ideas created in W
 * The recap is a DRAFT the owner reads and shares; nothing is sent for them.
 */

const inWeekFor = (t, week) => Object.values(t.powWeeks || {}).some((w) => Number(w) === Number(week))
  || (!t.powWeeks && Number(t.createdWeek) === Number(week) && t.status === 'pow');

/**
 * @param {object[]} tasks  normalized POW tasks (PowContext `tasks`)
 * @param {number} week     the week to summarize (normally last week)
 */
export function powWeekSummary(tasks = [], week) {
  const done = tasks.filter((t) => t.status === 'done' && Number(t.doneWeek) === Number(week));
  const carried = tasks.filter((t) => t.status === 'pow' && inWeekFor(t, week));
  const added = tasks.filter((t) => Number(t.createdWeek) === Number(week) && t.status === 'backlog');

  const byPerson = {};
  for (const t of [...done, ...carried]) {
    for (const person of t.assignees?.length ? t.assignees : ['Unassigned']) {
      byPerson[person] = byPerson[person] || { done: 0, carried: 0 };
      if (t.status === 'done') byPerson[person].done += 1;
      else byPerson[person].carried += 1;
    }
  }

  return { week, done, carried, added, byPerson };
}

/** Plain-text recap to paste into WhatsApp / an email. */
export function powSummaryText(summary) {
  const list = (items) => items.map((t) => `• ${t.title}${t.assignees?.length ? ` (${t.assignees.join(', ')})` : ''}`).join('\n');
  const parts = [`POW — week ${summary.week} recap`];
  parts.push(summary.done.length ? `\nDone (${summary.done.length}):\n${list(summary.done)}` : '\nDone: nothing marked done.');
  if (summary.carried.length) parts.push(`\nCarried into this week (${summary.carried.length}):\n${list(summary.carried)}`);
  if (summary.added.length) parts.push(`\nNew in the backlog (${summary.added.length}):\n${list(summary.added)}`);
  return parts.join('\n');
}
