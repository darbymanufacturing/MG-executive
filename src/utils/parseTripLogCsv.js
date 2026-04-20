/**
 * parseTripLogCsv.js
 * Parses the Hopp trip-log CSV export for a single scooter.
 *
 * CSV format (exported from Hopp vehicle detail → Trips tab):
 *   Type, Started / Created, Ended, User, Length, End reason, Cost, Is Paid
 *
 * Key quirks:
 *  - Multiline quoted cells: "13:06\n18 Apr 2026" (time + date across two lines)
 *  - Length cell: "6 minutes\n1.43 km" or "55 seconds\n0.05 km"
 *  - Cost cell: "€2.55" or "€2.05\n€1.25" (unlock + ride charge)
 *  - No scooterId — caller must supply it.
 *
 * Returns { rows: object[], errors: string[], total: number }
 * Each row: { scooterId, startedAt, endedAt, userId, durationMinutes, distanceKm, endReason, cost, isPaid, _docId }
 */

/**
 * Full RFC 4180 CSV parser — handles quoted fields with embedded newlines.
 * Returns array of string arrays (rows → cols).
 */
function parseCSVRaw(text) {
  const rows = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    const row = [];
    let firstField = true;

    while (i < n) {
      // After the first field, expect a comma before each field
      if (!firstField) {
        if (text[i] === ',') {
          i++;
        } else {
          // End of row (newline or EOF)
          if (text[i] === '\r') i++;
          if (i < n && text[i] === '\n') i++;
          break;
        }
      }
      firstField = false;

      let field = '';
      if (i < n && text[i] === '"') {
        // Quoted field — may contain embedded commas and newlines
        i++; // skip opening quote
        while (i < n) {
          if (text[i] === '"') {
            if (i + 1 < n && text[i + 1] === '"') {
              // Escaped double-quote
              field += '"';
              i += 2;
            } else {
              i++; // skip closing quote
              break;
            }
          } else {
            field += text[i++];
          }
        }
      } else {
        // Unquoted field
        while (i < n && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
          field += text[i++];
        }
      }
      row.push(field);
    }

    if (row.length > 0 && !(row.length === 1 && row[0].trim() === '')) {
      rows.push(row);
    }
  }

  return rows;
}

/**
 * Parse "13:06\n18 Apr 2026" → ISO date string "2026-04-18T13:06:00"
 */
function parseHoppDateTime(raw) {
  if (!raw) return null;
  // Field contains "HH:MM\nDD Mon YYYY"
  const parts = raw.split('\n').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) {
    // Try single-line fallback: "13:06 18 Apr 2026"
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const [timePart, datePart] = parts;
  const combined = `${datePart} ${timePart}`;
  const d = new Date(combined);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Parse "6 minutes\n1.43 km" → { durationMinutes: 6, distanceKm: 1.43 }
 * Also handles "55 seconds\n0.05 km", "1 hour 2 minutes\n10.5 km"
 */
function parseLength(raw) {
  if (!raw) return { durationMinutes: null, distanceKm: null };
  const parts = raw.split('\n').map((s) => s.trim()).filter(Boolean);
  let durationMinutes = null;
  let distanceKm      = null;

  const durationStr = parts[0] || '';
  const distStr     = parts[1] || '';

  // Parse duration: "X minutes", "X seconds", "X hours Y minutes"
  const hrMatch  = durationStr.match(/(\d+)\s*hour/i);
  const minMatch = durationStr.match(/(\d+)\s*min/i);
  const secMatch = durationStr.match(/(\d+)\s*sec/i);

  let totalMin = 0;
  if (hrMatch)  totalMin += parseInt(hrMatch[1], 10) * 60;
  if (minMatch) totalMin += parseInt(minMatch[1], 10);
  if (secMatch) totalMin += parseInt(secMatch[1], 10) / 60;
  if (hrMatch || minMatch || secMatch) durationMinutes = parseFloat(totalMin.toFixed(2));

  // Parse distance: "1.43 km" or "0 km"
  const kmMatch = distStr.match(/([\d.]+)\s*km/i);
  if (kmMatch) distanceKm = parseFloat(kmMatch[1]);

  return { durationMinutes, distanceKm };
}

/**
 * Parse "€2.55" or "€2.05\n€1.25" → cost as number
 * When two values present, take the sum (unlock fee + ride cost).
 */
function parseCost(raw) {
  if (!raw) return null;
  const parts = raw.split('\n').map((s) => s.replace(/[€\s]/g, '').trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const values = parts.map(parseFloat).filter((v) => !isNaN(v));
  if (values.length === 0) return null;
  // Sum all components (unlock + ride)
  return parseFloat(values.reduce((s, v) => s + v, 0).toFixed(2));
}

export function parseTripLogCsv(csvText, scooterId) {
  if (!scooterId) {
    return { rows: [], errors: ['scooterId is required — specify which scooter this log belongs to.'], total: 0 };
  }

  const allRows = parseCSVRaw(csvText);
  if (allRows.length < 2) {
    return { rows: [], errors: ['File appears empty or has no data rows.'], total: 0 };
  }

  // Normalise headers
  const headers = allRows[0].map((h) => h.toLowerCase().replace(/[\s/]+/g, '_').trim());

  // Map header → col index
  const col = (names) => {
    for (const name of names) {
      const idx = headers.findIndex((h) => h.includes(name));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const iType       = col(['type']);
  const iStarted    = col(['started', 'created']);
  const iEnded      = col(['ended']);
  const iUser       = col(['user']);
  const iLength     = col(['length']);
  const iEndReason  = col(['end_reason', 'reason']);
  const iCost       = col(['cost']);
  const iIsPaid     = col(['paid']);

  const rows   = [];
  const errors = [];

  for (let ri = 1; ri < allRows.length; ri++) {
    const cols = allRows[ri];
    if (cols.length <= 1) continue;

    // Only process Trip rows (skip Reservation, Parking etc if present)
    const type = iType >= 0 ? cols[iType]?.trim() : 'Trip';
    if (type && type.toLowerCase() !== 'trip') continue;

    const startedRaw = iStarted >= 0 ? cols[iStarted] : '';
    const endedRaw   = iEnded   >= 0 ? cols[iEnded]   : '';
    const startedAt  = parseHoppDateTime(startedRaw);

    if (!startedAt) {
      errors.push(`Row ${ri + 1}: could not parse start time "${startedRaw}" — skipped.`);
      continue;
    }

    const endedAt = parseHoppDateTime(endedRaw);
    const { durationMinutes, distanceKm } = parseLength(iLength >= 0 ? cols[iLength] : '');
    const cost      = parseCost(iCost >= 0 ? cols[iCost] : '');
    const userId    = iUser      >= 0 ? cols[iUser]?.trim()      || null : null;
    const endReason = iEndReason >= 0 ? cols[iEndReason]?.trim() || null : null;
    const isPaid    = iIsPaid    >= 0 ? cols[iIsPaid]?.trim().toLowerCase() === 'yes' : null;

    // DocId: scooterId + startedAt for idempotent upsert
    const _docId = `${scooterId}_${startedAt.replace(/[:.]/g, '-')}`;

    rows.push({
      scooterId:       String(scooterId),
      startedAt,
      endedAt,
      userId,
      durationMinutes,
      distanceKm,
      endReason,
      cost,
      isPaid,
      _docId,
    });
  }

  return { rows, errors, total: rows.length };
}
