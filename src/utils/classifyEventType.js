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

const CHARGING_STATES = new Set([
  'Charging', 'In Charging', 'Battery Swap',
]);

/**
 * @param {string} beforeState - raw "Before State" column value
 * @param {string} afterState  - raw "After State" column value
 * @param {string} reason      - raw "Reason" column value (may be empty)
 * @returns {string}           - one of the eventType enum values
 */
export function classifyEventType(beforeState, afterState, reason = '') {
  const after  = (afterState  || '').trim().toLowerCase();
  const before = (beforeState || '').trim().toLowerCase();
  const rsn    = (reason      || '').trim().toLowerCase();

  // Trip events
  if (after === 'trip' || after === 'on trip')                     return 'trip_start';
  if (before === 'trip' || before === 'on trip') {
    if (after === 'available' || after === 'ready')                return 'trip_end';
    return 'trip_end'; // any state after trip counts as ended
  }

  // Overturn detection (platform may use "Overturned" or "Overturn")
  if (after.includes('overturn') || after.includes('fallen'))     return 'overturned';
  if (before.includes('overturn') && (after === 'available' || after === 'ready' || after === 'rebalancing')) {
    return 'raised'; // overturn cleared
  }

  // Rebalance
  if (REBALANCE_STATES.has(afterState?.trim()))                    return 'rebalance_start';
  if (REBALANCE_STATES.has(beforeState?.trim()) &&
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

/** Returns true if the given eventType represents an overturn in real operation
 *  (vs an overturn during transport/rebalance which doesn't count for risk scoring). */
export function isTrueOverturn(event) {
  if (event.eventType !== 'overturned') return false;
  const before = (event.beforeState || '').trim();
  return !REBALANCE_STATES.has(before);
}
