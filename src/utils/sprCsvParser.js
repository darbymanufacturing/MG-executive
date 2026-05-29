/**
 * CSV parser for SPR platform event exports (Raw_Rebalance format).
 *
 * Expected columns (flexible — uses header-based matching):
 *   ScooterID, DATE & TIME, Before State, After State, Reason/Action,
 *   Lat, Lon, Battery Level, Rebalance State
 *
 * Rebalance State values: PICKUP | DROP | (empty for non-rebalance events)
 */

// #213 — use the canonical parseCSVRow from csvParser.js so all parsers share one
// implementation. The old local parseRow had identical logic but was a duplicate.
import { parseCSVRow as parseRow } from './csvParser.js';

/** Normalise a raw string from CSV to a clean value. */
function clean(val) {
  if (val == null) return '';
  return String(val).replace(/^"|"$/g, '').trim();
}

/** Parse a float; returns null on failure. */
function parseCoord(val) {
  const c = clean(val);
  if (!c || c === '-') return null;
  const n = parseFloat(c);
  return isNaN(n) ? null : n;
}

/**
 * Normalise a datetime string to ISO format "YYYY-MM-DDTHH:MM:SS".
 * Handles common platform export formats.
 */
function normaliseDateTime(raw) {
  const s = clean(raw);
  if (!s) return null;

  // Already ISO-ish: "2025-07-28 14:30:00" or "2025-07-28T14:30:00"
  if (/^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}/.test(s)) {
    return s.replace(' ', 'T').slice(0, 19);
  }

  // Try native Date parsing as fallback
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 19);

  return null;
}

const REQUIRED_HEADERS = ['ScooterID', 'DATE & TIME'];
const OPTIONAL_HEADERS = [
  'Before State', 'After State', 'Reason/Action',
  'Lat', 'Lon', 'Battery Level', 'Rebalance State',
];

/**
 * Parse a full CSV export string into an array of SPR event objects.
 * Returns { rows, errors, total }
 */
export function parseEventsCSV(csvText, zones = []) {
  const lines = csvText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return { rows: [], errors: ['File appears to be empty or has no data rows.'], total: 0 };
  }

  // Find the header row — some exports embed extra rows before the header
  let headerIdx = 0;
  let headerValues = [];
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const cols = parseRow(lines[i]);
    if (REQUIRED_HEADERS.every((h) => cols.some((c) => clean(c) === h))) {
      headerIdx = i;
      headerValues = cols.map(clean);
      break;
    }
  }

  if (!headerValues.length) {
    return {
      rows: [],
      errors: [`Could not find required columns: ${REQUIRED_HEADERS.join(', ')}. Check the CSV format.`],
      total: 0,
    };
  }

  // Build column index map (case-insensitive fallback)
  function colIdx(name) {
    const exact = headerValues.indexOf(name);
    if (exact >= 0) return exact;
    const lower = name.toLowerCase();
    return headerValues.findIndex((h) => h.toLowerCase() === lower);
  }

  const idx = {
    scooterId:      colIdx('ScooterID'),
    datetime:       colIdx('DATE & TIME'),
    beforeState:    colIdx('Before State'),
    afterState:     colIdx('After State'),
    action:         colIdx('Reason/Action'),
    lat:            colIdx('Lat'),
    lon:            colIdx('Lon'),
    battery:        colIdx('Battery Level'),
    rebalanceState: colIdx('Rebalance State'),
  };

  const rows = [];
  const errors = [];
  const seen = new Set();

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = parseRow(lines[i]);

    const scooterId = clean(cols[idx.scooterId]);
    const rawDt     = clean(cols[idx.datetime]);
    const datetime  = normaliseDateTime(rawDt);

    if (!scooterId) {
      errors.push(`Row ${i + 1}: Missing ScooterID — skipped.`);
      continue;
    }
    if (!datetime) {
      errors.push(`Row ${i + 1}: Could not parse datetime "${rawDt}" — skipped.`);
      continue;
    }

    // Dedup key
    const dedupKey = `${scooterId}_${datetime}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const lat = parseCoord(cols[idx.lat]);
    const lon = parseCoord(cols[idx.lon]);

    // Auto-assign zone from GPS if zones are provided
    let zone = null;
    if (lat !== null && lon !== null && zones.length) {
      const match = zones.find(
        (z) =>
          lat >= z.minLat && lat <= z.maxLat &&
          lon >= z.minLon && lon <= z.maxLon
      );
      zone = match?.name ?? null;
    }

    const rebalanceState = clean(cols[idx.rebalanceState]) || null;

    rows.push({
      scooterId,
      datetime,
      beforeState:    clean(cols[idx.beforeState]) || null,
      afterState:     clean(cols[idx.afterState])  || null,
      action:         clean(cols[idx.action])      || null,
      lat,
      lon,
      batteryLevel:   parseCoord(cols[idx.battery]),
      rebalanceState: rebalanceState === 'PICKUP' || rebalanceState === 'DROP'
                        ? rebalanceState
                        : null,
      zone,
      importedAt: new Date().toISOString(),
    });
  }

  return { rows, errors, total: rows.length };
}
