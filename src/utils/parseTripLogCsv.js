/**
 * parseTripLogCsv.js
 * Scaffold CSV parser for scooterTrips. Final column mapping will be confirmed
 * once the user sends a sample Hopp/OTORide trip-log CSV.
 *
 * Expected columns (provisional — update when schema arrives):
 *   scooterId, startedAt, endedAt, userId, durationMinutes, distanceKm, endReason, cost
 *
 * Returns { rows: object[], errors: string[], total: number }
 *
 * DocId pattern: `${scooterId}_${startedAt}` — idempotent upsert / dedup.
 */

/** Normalise a header string: lowercase, trim, collapse spaces + underscores */
function norm(h) {
  return h.toLowerCase().trim().replace(/[\s_-]+/g, '_');
}

/** Map normalised header → canonical field name */
const FIELD_MAP = {
  scooter_id:       'scooterId',
  scooter:          'scooterId',
  vehicle_id:       'scooterId',
  started_at:       'startedAt',
  start_time:       'startedAt',
  trip_start:       'startedAt',
  ended_at:         'endedAt',
  end_time:         'endedAt',
  trip_end:         'endedAt',
  user_id:          'userId',
  rider_id:         'userId',
  duration_minutes: 'durationMinutes',
  duration_min:     'durationMinutes',
  duration:         'durationMinutes',
  distance_km:      'distanceKm',
  distance:         'distanceKm',
  km:               'distanceKm',
  end_reason:       'endReason',
  end_type:         'endReason',
  cost:             'cost',
  fare:             'cost',
  revenue:          'cost',
};

function parseLine(line) {
  // Simple CSV parse — handles quoted fields
  const cols = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      cols.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur.trim());
  return cols;
}

export function parseTripLogCsv(csvText) {
  const lines  = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], errors: ['File appears empty.'], total: 0 };

  const rawHeaders = parseLine(lines[0]);
  const headers    = rawHeaders.map(norm);

  // Map column index → canonical field
  const colMap = {};
  headers.forEach((h, i) => {
    const field = FIELD_MAP[h];
    if (field) colMap[i] = field;
  });

  if (!Object.values(colMap).includes('scooterId')) {
    return { rows: [], errors: ['Could not find a scooterId column. Check column headers match the expected format.'], total: 0 };
  }
  if (!Object.values(colMap).includes('startedAt')) {
    return { rows: [], errors: ['Could not find a startedAt / trip_start column.'], total: 0 };
  }

  const rows   = [];
  const errors = [];

  for (let li = 1; li < lines.length; li++) {
    const cols = parseLine(lines[li]);
    if (cols.length === 1 && cols[0] === '') continue; // blank line

    const raw = {};
    Object.entries(colMap).forEach(([idx, field]) => {
      raw[field] = cols[Number(idx)] ?? '';
    });

    if (!raw.scooterId || !raw.startedAt) {
      errors.push(`Row ${li + 1}: missing scooterId or startedAt — skipped.`);
      continue;
    }

    const row = {
      scooterId:       String(raw.scooterId).trim(),
      startedAt:       raw.startedAt.trim(),
      endedAt:         raw.endedAt?.trim() || null,
      userId:          raw.userId?.trim()  || null,
      durationMinutes: raw.durationMinutes ? parseFloat(raw.durationMinutes) : null,
      distanceKm:      raw.distanceKm      ? parseFloat(raw.distanceKm)      : null,
      endReason:       raw.endReason?.trim() || null,
      cost:            raw.cost             ? parseFloat(raw.cost)            : null,
      _docId:          `${raw.scooterId.trim()}_${raw.startedAt.trim()}`,
    };

    rows.push(row);
  }

  return { rows, errors, total: rows.length };
}
