/**
 * POW (Progress of Week) helper utilities.
 * POW = Monday weekly sync between Kostas and Panos.
 */

/** Returns true if today is Monday (local time). */
export function isPowDay() {
  return new Date().getDay() === 1;
}

/** Days elapsed since a given ISO date string (or Firestore Timestamp). */
export function daysSince(dateInput) {
  if (!dateInput) return null;
  const date = dateInput?.toDate ? dateInput.toDate() : new Date(dateInput);
  const diffMs = Date.now() - date.getTime();
  return Math.floor(diffMs / 86_400_000);
}

/**
 * "Week of Apr 14–20" label for a given ISO date (start of week).
 * Accepts a Date or ISO string. Returns the Mon–Sun label.
 */
export function weekOfLabel(dateInput) {
  const date = dateInput ? new Date(dateInput) : new Date();
  // Find Monday of the current week
  const day = date.getDay(); // 0=Sun, 1=Mon…
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(date);
  mon.setDate(date.getDate() + diffToMon);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);

  const opts = { month: 'short', day: 'numeric' };
  const monStr = mon.toLocaleDateString('en-GB', opts);
  const sunStr = sun.toLocaleDateString('en-GB', opts);
  return `Week of ${monStr}–${sunStr}`;
}

/** ISO string of the start (Monday) of this week. */
export function currentWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setDate(now.getDate() + diffToMon);
  return mon.toISOString().slice(0, 10);
}

/** Friendly relative label: "2 days ago", "today", etc. */
export function relativeLabel(dateInput) {
  const days = daysSince(dateInput);
  if (days === null) return '—';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

/** Staleness severity for last-updated timestamps per spec. */
export function updateStaleness(dateInput) {
  const days = daysSince(dateInput);
  if (days === null) return 'none';
  if (days >= 8) return 'red';
  if (days >= 5) return 'amber';
  return 'none';
}

/** Staleness severity for POW entries per spec (red > 10 days). */
export function powStaleness(dateInput) {
  const days = daysSince(dateInput);
  if (days === null) return 'red'; // never logged
  if (days > 10) return 'red';
  return 'none';
}
