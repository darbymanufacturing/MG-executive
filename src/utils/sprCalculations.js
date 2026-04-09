/**
 * SPR Calculations — zone matching, daily aggregations, spot performance.
 */

/** Returns the zone name for a lat/lon point, or null if unmatched. */
export function findZoneForPoint(lat, lon, zones) {
  if (!lat || !lon || !zones?.length) return null;
  const match = zones.find(
    (z) =>
      lat >= z.minLat && lat <= z.maxLat &&
      lon >= z.minLon && lon <= z.maxLon
  );
  return match?.name ?? null;
}

/** Returns the date string part (YYYY-MM-DD) from an ISO datetime string. */
export function toDateStr(datetime) {
  if (!datetime) return null;
  return datetime.slice(0, 10);
}

/**
 * Given all events for a city, compute the last known zone for every scooter
 * as of a given date at or before morningHour (default 10:00).
 *
 * Returns: { [scooterId]: zoneName | null }
 */
export function computeScooterDailyState(events, date, morningHour = 10) {
  const cutoff = `${date}T${String(morningHour).padStart(2, '0')}:00:00`;

  // Only events up to the morning cutoff
  const eligible = events.filter((e) => e.datetime <= cutoff);

  // For each scooter, keep the latest event
  const latest = {};
  eligible.forEach((e) => {
    if (!latest[e.scooterId] || e.datetime > latest[e.scooterId].datetime) {
      latest[e.scooterId] = e;
    }
  });

  const state = {};
  Object.entries(latest).forEach(([id, ev]) => {
    state[id] = ev.zone ?? null;
  });
  return state;
}

/**
 * Morning stock per zone on a given date.
 * Returns: { [zoneName]: count }
 */
export function computeMorningStock(events, zones, date, morningHour = 10) {
  const state = computeScooterDailyState(events, date, morningHour);
  const stock = {};
  zones.forEach((z) => { stock[z.name] = 0; });
  Object.values(state).forEach((zone) => {
    if (zone && stock[zone] !== undefined) stock[zone]++;
  });
  return stock;
}

/**
 * Count trips that started (PICKUP) in each zone on a given date.
 * Returns: { [zoneName]: count }
 */
export function computeRideVolume(events, zones, date) {
  const stock = {};
  zones.forEach((z) => { stock[z.name] = 0; });
  events.forEach((e) => {
    if (
      toDateStr(e.datetime) === date &&
      e.rebalanceState === 'PICKUP' &&
      e.zone &&
      stock[e.zone] !== undefined
    ) {
      stock[e.zone]++;
    }
  });
  return stock;
}

/**
 * Count trips that ended (DROP) in each zone on a given date.
 * Returns: { [zoneName]: count }
 */
export function computeReturnVolume(events, zones, date) {
  const stock = {};
  zones.forEach((z) => { stock[z.name] = 0; });
  events.forEach((e) => {
    if (
      toDateStr(e.datetime) === date &&
      e.rebalanceState === 'DROP' &&
      e.zone &&
      stock[e.zone] !== undefined
    ) {
      stock[e.zone]++;
    }
  });
  return stock;
}

/**
 * Build the full Spot Performance table for a date range.
 *
 * Returns array of rows:
 *   { date, zone, morningStock, rideVolume, returnVolume, zoneFlow, pickupRate }
 */
export function computeSpotPerformance({
  events,
  zones,
  weather,
  startDate,
  endDate,
  city,
  excludeRainy = true,
  morningHour = 10,
}) {
  if (!zones?.length || !startDate || !endDate) return [];

  const cityZones = zones.filter((z) => !city || z.city === city);
  const cityEvents = events.filter((e) => !city || e.city === city);

  // Build rainy day set
  const rainyDays = new Set(
    weather
      .filter((w) => (!city || w.city === city) && w.isRainy)
      .map((w) => w.date)
  );

  // Generate date range
  const dates = [];
  let cur = new Date(startDate + 'T12:00:00');
  const end = new Date(endDate + 'T12:00:00');
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }

  const rows = [];
  dates.forEach((date) => {
    if (excludeRainy && rainyDays.has(date)) return;

    const morningStock  = computeMorningStock(cityEvents, cityZones, date, morningHour);
    const rideVolume    = computeRideVolume(cityEvents, cityZones, date);
    const returnVolume  = computeReturnVolume(cityEvents, cityZones, date);

    cityZones.forEach((z) => {
      const ms = morningStock[z.name] ?? 0;
      const rv = rideVolume[z.name]   ?? 0;
      const ret = returnVolume[z.name] ?? 0;
      rows.push({
        date,
        zone:         z.name,
        morningStock: ms,
        rideVolume:   rv,
        returnVolume: ret,
        zoneFlow:     ret - rv,
        pickupRate:   ms > 0 ? rv / ms : null,
        isRainy:      rainyDays.has(date),
      });
    });
  });

  return rows;
}

/**
 * Get all unique dates in the events data (sorted descending).
 */
export function getEventDates(events) {
  const dates = new Set(events.map((e) => toDateStr(e.datetime)).filter(Boolean));
  return [...dates].sort((a, b) => (a < b ? 1 : -1));
}

/** Unique scooter IDs in the events data. */
export function getScooterIds(events) {
  return [...new Set(events.map((e) => e.scooterId).filter(Boolean))].sort();
}
