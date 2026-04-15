/**
 * classifyEventType.js
 * Maps (beforeState, afterState, reason) → a canonical eventType enum value.
 *
 * Platform state names come directly from the Status Log CSV export.
 * Extend this map as new state transitions are observed in production.
 */

const REBALANCE_STATES = new Set([
  'Rebalancing', 'Rebalance', 'Maintenance Transport',
  'Transport', 'In Transport',
]);

// Lowercase variant for case-insensitive checks against raw CSV values
const REBALANCE_LOWER = new Set([...REBALANCE_STATES].map((s) => s.toLowerCase()));

const CHARGING_STATES = new Set([
  'Charging', 'In Charging', 'Battery Swap',
]);

/**
 * @param {string} beforeState - raw "Before State" column value
 * @param {string} afterState  - raw "After State" column value
 * @param {string} reason      - raw "Reason" column value (may be empty)
 * @returns {string}           - one of the eventType enum values
 */
const TRIP_STATES   = new Set(['trip', 'on trip']);
const PAUSED_STATES = new Set(['paused', 'trip paused', 'pause']);

export function classifyEventType(beforeState, afterState, reason = '') {
  const after  = (afterState  || '').trim().toLowerCase();
  const before = (beforeState || '').trim().toLowerCase();
  const rsn    = (reason      || '').trim().toLowerCase();

  // Overturn detection — MUST run before trip/trip_end checks so that
  // "Trip → Overturned" is caught as an overturn rather than mis-classified
  // as a trip end. This was the cause of overturns-always-zero in the UI.
  if (after.includes('overturn') || after.includes('fallen'))      return 'overturned';
  if (before.includes('overturn') &&
      (after === 'available' || after === 'ready' || after === 'rebalancing')) {
    return 'raised'; // overturn cleared
  }

  // Trip events — treat pause/resume as NOT creating new trips.
  // This prevents double-counting trips when a rider pauses mid-ride.
  if (TRIP_STATES.has(after)) {
    // Resuming from pause or continuing an ongoing trip state isn't a new trip
    if (TRIP_STATES.has(before) || PAUSED_STATES.has(before))      return 'trip_resume';
    return 'trip_start';
  }
  if (TRIP_STATES.has(before) || PAUSED_STATES.has(before)) {
    if (PAUSED_STATES.has(after))                                  return 'trip_pause';
    // Leaving a trip/paused state to anything resting = trip ended
    return 'trip_end';
  }

  // Rebalance (case-insensitive on the raw state check)
  if (REBALANCE_LOWER.has(after))                                  return 'rebalance_start';
  if (REBALANCE_LOWER.has(before) &&
      (after === 'available' || after === 'ready'))                return 'rebalance_end';

  // Battery operations
  if (after.includes('battery swap') || rsn.includes('battery swap')) return 'battery_swap';
  if (after.includes('low battery') || after === 'low_battery')    return 'low_battery';
  if (CHARGING_STATES.has(afterState?.trim()))                     return 'battery_swap';

  // Reservation
  if (after === 'reserved' || after === 'reservation')             return 'reserved';

  // Removal / deactivation
  if (after === 'removed' || after === 'inactive' ||
      after === 'deactivated' || after === 'retired')              return 'removed';

  // Maintenance / repair
  if (after.includes('maintenance') || after.includes('repair') ||
      after.includes('workshop') || after.includes('service'))     return 'maintenance_start';

  return 'other';
}

/**
 * Returns true if the event represents a genuine overturn in real operation
 * (vs an overturn during transport/rebalance, which doesn't count for risk scoring).
 *
 * Uses case-insensitive matching against beforeState because CSV exports from
 * the platform may vary casing. Also falls back to checking afterState directly
 * in case the eventType wasn't classified correctly at ingest time.
 */
export function isTrueOverturn(event) {
  // Primary check via stored eventType; fallback via raw afterState for robustness
  const isOverturn =
    event.eventType === 'overturned' ||
    (event.afterState || '').toLowerCase().includes('overturn') ||
    (event.afterState || '').toLowerCase().includes('fallen');

  if (!isOverturn) return false;

  // Exclude overturns that happened while the scooter was being rebalanced/transported
  const before = (event.beforeState || '').trim().toLowerCase();
  return !REBALANCE_LOWER.has(before);
}
