/**
 * repairJunkFilter.js
 * Identifies junk/test repair log entries non-destructively.
 * Entries remain in Firestore; this marks them valid: false in-memory.
 *
 * Validated against real XSlide repair history (scooter 67411, others).
 */

const JUNK_PATTERNS = [
  /wrong[\s-]?km/i,
  /fake[\s-]?km/i,
  /\bspam\b/i,
  /test[\s-]?entry/i,
  /\btest\b.*repair/i,
  /repair.*\btest\b/i,
  /dummy/i,
  /placeholder/i,
  /^\s*n\/a\s*$/i,
  /^\s*-+\s*$/, // rows that are just dashes
];

/**
 * Returns true if the ticket looks like a junk / test entry.
 * Checks both issueDescription and notes fields.
 */
export function isJunkTicket(ticket) {
  const text = [
    ticket.issueDescription || '',
    ticket.notes            || '',
    ticket.comment          || '',
    ticket.realIssue        || '',
  ].join(' ');

  return JUNK_PATTERNS.some((re) => re.test(text));
}

/**
 * Annotates an array of tickets with { ...ticket, valid: boolean }.
 * Non-destructive — originals are never mutated.
 */
export function annotateTicketValidity(tickets) {
  return tickets.map((t) => ({
    ...t,
    valid: !isJunkTicket(t),
  }));
}

/** Returns only valid (non-junk) tickets */
export function validTickets(tickets) {
  return tickets.filter((t) => !isJunkTicket(t));
}
