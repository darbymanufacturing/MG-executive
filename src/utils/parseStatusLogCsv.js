/**
 * parseStatusLogCsv.js
 * Parses the platform's Status Log CSV export into telemetryEvent docs.
 *
 * Expected columns (exact platform export format):
 *   Time, User, Before State, After State, Reason, Location, Battery Level
 *
 * The scooterId must be provided externally (the CSV is per-scooter or combined
 * with a scooter_id column). We handle both cases.
 *
 * Returns: { events: [...], errors: [...], total: number }
 */

import { classifyEventType } from './classifyEventType.js';

// Canonical column names — case-insensitive match
const COL_ALIASES = {
  time:          ['time', 'timestamp', 'date time', 'date & time', 'datetime'],
  user:          ['user', 'operator', 'staff'],
  beforeState:   ['before state', 'before_state', 'from state', 'from_state', 'state before'],
  afterState:    ['after state', 'after_state', 'to state', 'to_state', 'state after', 'state'],
  reason:        ['reason', 'reason code', 'reason_code'],
  location:      ['location', 'city', 'zone', 'area'],
  batteryLevel:  ['battery level', 'battery_level', 'battery', 'battery %', 'soc'],
  scooterId:     ['scooter id', 'scooter_id', 'vehicle id', 'vehicle_id', 'id', 'device id'],
};

/** Parse a single quoted CSV row into string array. Reused from csvParser.js pattern. */
function parseRow(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current.trim());
  return values;
}

function resolveColumn(headers, aliases) {
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());
  for (const alias of aliases) {
    const idx = lowerHeaders.indexOf(alias);
    if (idx !== -1) return idx;
  }
  return -1;
}

/** Parse "DD/MM/YYYY HH:mm" or ISO timestamp → ISO string */
function parseTimestamp(raw) {
  if (!raw) return null;
  const clean = raw.replace(/"/g, '').trim();
  // Try ISO first
  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
    const d = new Date(clean);
    return isNaN(d) ? null : d.toISOString();
  }
  // Try "DD/MM/YYYY HH:mm" or "DD/MM/YYYY HH:mm:ss"
  // #126 — also detect US-format (MM/DD/YYYY) where first part > 12 means it must be a day
  const m = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    let [, part1, part2, y, h, min, s = '00'] = m;
    const p1 = parseInt(part1, 10);
    const p2 = parseInt(part2, 10);

    let dayStr, moStr;
    if (p1 > 12) {
      // part1 can only be a day (US MM/DD/YYYY would put month first, but month can't be >12)
      // Actually if p1>12, this must be DD/MM/YYYY
      dayStr = part1; moStr = part2;
    } else if (p2 > 12) {
      // part2 can't be a month, so this is MM/DD/YYYY (US format)
      // Swap: part1=month, part2=day
      moStr = part1; dayStr = part2;
      // Log ambiguity note
    } else {
      // Ambiguous — assume DD/MM/YYYY (platform-native format for Greece)
      dayStr = part1; moStr = part2;
    }

    // Validate the resulting date
    const moNum = parseInt(moStr, 10);
    const dayNum = parseInt(dayStr, 10);
    if (moNum < 1 || moNum > 12 || dayNum < 1 || dayNum > 31) {
      console.warn(`parseStatusLogCsv: Could not parse date "${clean}" - try DD/MM/YYYY format`);
      return null;
    }

    // #125 — store as local Athens time (no Z suffix); not UTC
    const iso = `${y}-${moStr.padStart(2,'0')}-${dayStr.padStart(2,'0')}T${h.padStart(2,'0')}:${min}:${s}`;
    const dt = new Date(iso);
    return isNaN(dt) ? null : iso;
  }
  return null;
}

function parseBattery(raw) {
  if (!raw) return null;
  const n = parseFloat(raw.replace(/[^0-9.]/g, ''));
  return isNaN(n) ? null : Math.min(100, Math.max(0, n));
}

/**
 * @param {string} csvText   - raw CSV file content
 * @param {string} [defaultScooterId] - scooter ID if not in CSV (per-scooter file)
 * @param {object} [scooterCityMap]   - { scooterId: city } for city derivation at ingest
 * @returns {{ events: object[], errors: string[], total: number }}
 */
export function parseStatusLogCsv(csvText, defaultScooterId = null, scooterCityMap = {}) {
  // Strip UTF-8 BOM if present — otherwise first header column gets "\uFEFFTime"
  // and column resolution fails silently, breaking the whole import.
  let text = csvText || '';
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  // Accept \r\n, \n, and \r line endings
  const lines = text.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return { events: [], errors: ['File appears empty or has no data rows.'], total: 0 };
  }

  const headers    = parseRow(lines[0]);
  const colTime    = resolveColumn(headers, COL_ALIASES.time);
  const colUser    = resolveColumn(headers, COL_ALIASES.user);
  const colBefore  = resolveColumn(headers, COL_ALIASES.beforeState);
  const colAfter   = resolveColumn(headers, COL_ALIASES.afterState);
  const colReason  = resolveColumn(headers, COL_ALIASES.reason);
  const colLoc     = resolveColumn(headers, COL_ALIASES.location);
  const colBatt    = resolveColumn(headers, COL_ALIASES.batteryLevel);
  const colScooter = resolveColumn(headers, COL_ALIASES.scooterId);

  if (colTime === -1 || colAfter === -1) {
    return {
      events: [],
      errors: [
        `Could not find required columns (Time, After State) in the CSV. ` +
        `Detected headers: ${headers.join(' | ')}. ` +
        `Expected any of: ${COL_ALIASES.time.join(', ')} for Time, ` +
        `${COL_ALIASES.afterState.join(', ')} for After State.`,
      ],
      total: 0,
    };
  }

  const events = [];
  const errors = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseRow(lines[i]);
    const timestamp = parseTimestamp(cols[colTime]);
    if (!timestamp) {
      errors.push(`Row ${i + 1}: Could not parse timestamp "${cols[colTime]}"`);
      continue;
    }

    const scooterId  = colScooter !== -1 ? cols[colScooter]?.trim() : defaultScooterId;
    if (!scooterId) {
      errors.push(`Row ${i + 1}: No scooter ID found. Provide a default scooter ID or add a "Scooter ID" column.`);
      continue;
    }

    const beforeState = colBefore !== -1 ? (cols[colBefore] || '').trim() : '';
    const afterState  = (cols[colAfter]  || '').trim();
    const reason      = colReason !== -1  ? (cols[colReason]  || '').trim() : '';
    const location    = colLoc    !== -1  ? (cols[colLoc]     || '').trim() : '';
    const batteryLevel = colBatt  !== -1  ? parseBattery(cols[colBatt]) : null;

    const eventType = classifyEventType(beforeState, afterState, reason);
    const city      = scooterCityMap[scooterId] || '';

    // Fingerprint docId — deterministic, enables idempotent upsert
    // #194 — include beforeState in the key to avoid collision when the same
    // scooter+timestamp has multiple rows differing only in beforeState.
    const safeAfter  = afterState.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
    const beforeKey  = (beforeState || '').replace(/\s/g, '').slice(0, 8);
    const docId      = `${scooterId}_${timestamp.replace(/[^0-9T]/g, '')}_${safeAfter}_${beforeKey}`;

    events.push({
      _docId: docId,
      scooterId,
      timestamp,
      user:         colUser !== -1 ? (cols[colUser] || '').trim() : '',
      beforeState,
      afterState,
      reason,
      location,
      batteryLevel,
      eventType,
      city,
    });
  }

  return { events, errors, total: events.length };
}
