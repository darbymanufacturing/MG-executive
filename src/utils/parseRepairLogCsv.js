/**
 * parseRepairLogCsv.js
 * Parses the platform's Repair Log CSV export.
 *
 * Expected columns (platform-native format):
 *   Issue Type, Issue Tags, Real Issue, Comment, Parts used, Created, Fixed, Fixed By
 *
 * Scooter ID must be in the CSV (column "Scooter ID" / "Vehicle ID") or provided
 * as a default for per-scooter files.
 *
 * Maps to the existing maintenanceTickets collection shape so these entries
 * can be merged with manually-created tickets.
 *
 * Returns: { tickets: [...], errors: [...], total: number }
 */

const COL_ALIASES = {
  scooterId:  ['scooter id', 'scooter_id', 'vehicle id', 'vehicle_id', 'id', 'device id'],
  issueType:  ['issue type', 'issue_type', 'type'],
  issueTags:  ['issue tags', 'issue_tags', 'tags'],
  realIssue:  ['real issue', 'real_issue', 'actual issue', 'root cause'],
  comment:    ['comment', 'comments', 'notes', 'description'],
  partsUsed:  ['parts used', 'parts_used', 'parts', 'spare parts'],
  created:    ['created', 'created at', 'created_at', 'date created', 'date entered', 'open date'],
  fixed:      ['fixed', 'fixed at', 'fixed_at', 'date fixed', 'close date', 'completed'],
  fixedBy:    ['fixed by', 'fixed_by', 'technician', 'resolved by', 'assigned to'],
};

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
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const alias of aliases) {
    const idx = lower.indexOf(alias);
    if (idx !== -1) return idx;
  }
  return -1;
}

/** Parse "YYYY-MM-DD" or "DD/MM/YYYY" or "MM/DD/YYYY" → "YYYY-MM-DD" */
function parseDate(raw) {
  if (!raw) return null;
  const clean = raw.replace(/"/g, '').trim();
  if (!clean || clean === '-' || clean === 'N/A') return null;

  // ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) return clean.slice(0, 10);

  // DD/MM/YYYY
  const m1 = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m1) {
    const [, d, mo, y] = m1;
    return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }

  // Try native Date parse as fallback
  const d = new Date(clean);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);

  return null;
}

/**
 * @param {string} csvText
 * @param {string|null} defaultScooterId
 * @returns {{ tickets: object[], errors: string[], total: number }}
 */
export function parseRepairLogCsv(csvText, defaultScooterId = null) {
  const lines = csvText.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return { tickets: [], errors: ['File appears empty or has no data rows.'], total: 0 };
  }

  const headers     = parseRow(lines[0]);
  const colId       = resolveColumn(headers, COL_ALIASES.scooterId);
  const colType     = resolveColumn(headers, COL_ALIASES.issueType);
  const colTags     = resolveColumn(headers, COL_ALIASES.issueTags);
  const colReal     = resolveColumn(headers, COL_ALIASES.realIssue);
  const colComment  = resolveColumn(headers, COL_ALIASES.comment);
  const colParts    = resolveColumn(headers, COL_ALIASES.partsUsed);
  const colCreated  = resolveColumn(headers, COL_ALIASES.created);
  const colFixed    = resolveColumn(headers, COL_ALIASES.fixed);
  const colFixedBy  = resolveColumn(headers, COL_ALIASES.fixedBy);

  const tickets = [];
  const errors  = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseRow(lines[i]);

    const scooterId  = colId !== -1 ? cols[colId]?.trim() : defaultScooterId;
    if (!scooterId) {
      errors.push(`Row ${i + 1}: No scooter ID. Add a "Scooter ID" column or provide a default.`);
      continue;
    }

    const dateEntered = parseDate(colCreated !== -1 ? cols[colCreated] : null)
                      || new Date().toISOString().slice(0, 10);
    const dateCompleted = colFixed !== -1 ? parseDate(cols[colFixed]) : null;

    const issueType      = colType    !== -1 ? (cols[colType]    || '').trim() : '';
    const issueTags      = colTags    !== -1 ? (cols[colTags]    || '').trim() : '';
    const realIssue      = colReal    !== -1 ? (cols[colReal]    || '').trim() : '';
    const comment        = colComment !== -1 ? (cols[colComment] || '').trim() : '';
    const partsUsed      = colParts   !== -1 ? (cols[colParts]   || '').trim() : '';
    const fixedBy        = colFixedBy !== -1 ? (cols[colFixedBy] || '').trim() : '';

    // Map to maintenanceTickets shape
    // Fingerprint: scooterId + dateEntered (same as existing importer)
    const docId = `${scooterId}_${dateEntered}_repair`;

    tickets.push({
      _docId:          docId,
      scooterId,
      dateEntered,
      dateCompleted,
      issueDescription: [issueType, realIssue, comment].filter(Boolean).join(' — '),
      category:        'M',         // Mechanical — best default for repair log imports
      status:          dateCompleted ? 'Completed' : 'Active',
      primaryTag:      issueType   || 'Platform Import',
      secondaryTag:    issueTags   || '',
      realIssue,
      comment,
      partsUsed,
      fixedBy,
      notes:           `Imported from repair log. Tags: ${issueTags}`,
      importSource:    'repairLogCsv',
    });
  }

  return { tickets, errors, total: tickets.length };
}
