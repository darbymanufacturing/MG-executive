import { createContext, useContext, useCallback, useMemo, useEffect, useRef } from 'react';
import { doc, writeBatch } from 'firebase/firestore';
import { db, auth } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';
import { SEED_TICKETS, SEED_PARTS, SEED_CONFIG } from '../utils/maintenanceSeedData.js';
import { useOrg } from './OrgContext.jsx';
import { useOrgCollection } from '../hooks/useOrgCollection.js';
import { useOrgDoc } from '../hooks/useOrgDoc.js';
import { orgWrite, orgUpdate, orgDelete } from '../hooks/orgWrite.js';
import { orgDocId } from '../utils/orgDocId.js';

// ── Firestore paths (Phase 2 / ADR-0002+0003) ─────────────────────────────────
const TICKETS_COL  = 'maintenanceTickets';
const PARTS_COL    = 'maintenanceParts';
const SCOOTERS_COL = 'scooters';
const CONFIG_COL   = 'config';          // org-scoped singleton: config/${orgId}_maintenance
const BATCH_SIZE   = 450;
const MAX_TICKETS  = 2000;
const MAX_PARTS    = 2000;
const MAX_SCOOTERS = 1000;
const SCHEDULES_COL = 'maintenanceSchedules';
const MAX_SCHEDULES = 500;

// Deterministic doc IDs are org-PREFIXED to prevent cross-org collisions (two orgs
// can both own scooter "70055"). The business fields (scooterId/sku/dateEntered)
// stay unchanged inside the doc; only the Firestore doc id carries the org prefix.
// Consumers navigate/look up by the scooterId FIELD, never _docId (verified), so
// this is transparent to the UI. See ADR-0002 + the B3 collision note.
// Uses the shared orgDocId helper (single source of truth; also sanitizes forbidden chars).
const orgKey = orgDocId;

const DEFAULT_CONFIG = {
  revenueRatePerDay: 3.67,
  // Phase 2.5 F1 — contractor labour rate (€/hour) used to compute repair pay
  // from a procedure's estimatedMinutes. Admin sets it in Settings → Maintenance.
  labourRatePerHour: 25,
  maxActiveTickets:  3,
  customPrimaryTags:   [],
  customSecondaryTags: [],
  seasonalityIndex: {
    jan: 2.39, feb: 2.68, mar: 3.58, apr: 3.54,
    may: 3.57, jun: 4.83, jul: 5.95, aug: 5.76,
    sep: 3.32, oct: 2.70, nov: 2.34, dec: 3.35,
  },
};

// ── SKU → Model mapping (sourced from Xslide Maintenance Master V2.xlsx) ────
const SKU_MODEL_MAP = {
  "2010100184": "ES400B 2022", "2010200058": "ES400B 2022",
  "2010200117": "ES400B 2023", "2010400006": "ES400B 2023",
  "2010400033": "ES400B 2022", "2010500214": "Shared",
  "2010600027": "ES400B 2022", "2010600066": "ES400B 2023",
  "2010700097": "ES400B 2023", "2010700438": "ES400B 2022",
  "2010800084": "Shared",      "2010900037": "Shared",
  "2010900050": "Shared",      "2011000076": "Shared",
  "2011000086": "Shared",      "2011000097": "Shared",
  "2011000110": "ES400B 2022", "2011000155": "ES400B 2022",
  "2011000156": "ES400B 2022", "2011000173": "ES400B 2023",
  "2011000174": "ES400B 2023", "2011000188": "ES400B 2023",
  "2011200052": "ES400B 2022", "2011200067": "ES400B 2023",
  "2011300103": "Shared",      "2011300108": "Shared",
  "2011300117": "Shared",      "2011300127": "Shared",
  "2011300128": "Shared",      "2011300132": "ES400B 2022",
  "2011300141": "ES400B 2022", "2011300150": "Shared",
  "2011400060": "Shared",      "2011600002": "Shared",
  "2011600005": "Shared",      "2011800024": "Shared",
  "2011800043": "Shared",      "2020100038": "Shared",
  "2020100039": "Shared",      "2020100040": "Shared",
  "2020100046": "Shared",      "2020100144": "ES400B 2023",
  "2020100145": "ES400B 2023", "2020200040": "Shared",
  "2020500059": "ES400B 2022", "2020500091": "ES400B 2023",
  "2020600003": "Shared",      "2020700033": "ES400B 2022",
  "2020700034": "Shared",      "2020700043": "Shared",
  "2020700092": "ES400B 2023", "2020700100": "Shared",
  "2020800002": "Shared",      "2020800007": "Shared",
  "2020900037": "Shared",      "2020900039": "Shared",
  "2020900066": "Shared",      "2021000064": "Shared",
  "2021000065": "Shared",      "2021000072": "Shared",
  "2021000073": "Shared",      "2021000080": "Shared",
  "2021300006": "Shared",      "2021300007": "Shared",
  "2021300060": "Shared",      "2021500154": "Shared",
  "2021700008": "Shared",      "2021700009": "Shared",
  "2022100022": "Shared",      "2022100025": "Shared",
  "2030500135": "Shared",      "2030700020": "Shared",
  "2030800002": "Shared",      "2030900059": "ES400B 2022",
  "2030900090": "ES400B 2023", "2031000017": "Shared",
  "2031400014": "Shared",      "2031400019": "ES400B 2022",
  "2031400026": "Shared",      "2031400027": "Shared",
  "2031600021": "Shared",      "2031700024": "Shared",
  "2031700054": "Shared",      "2031800100": "Shared",
  "2031900070": "ES400B 2023", "2031900106": "ES400B 2022",
  "2032500003": "ES400B 2023", "2032500058": "ES400B 2022",
  "2036300005": "Shared",      "2040100107": "Shared",
  "2040100213": "Shared",      "2040100241": "Shared",
  "2040100272": "Shared",      "2040100276": "Shared",
  "2040100304": "Shared",      "2040100305": "Shared",
  "2040100310": "Shared",      "2040100326": "Shared",
  "2040100328": "Shared",      "2040100330": "Shared",
  "2040100343": "Shared",      "2040100346": "Shared",
  "2040100347": "Shared",      "2040100350": "Shared",
  "2040100369": "Shared",      "2040100370": "Shared",
  "2040100380": "Shared",      "2040100395": "Shared",
  "2040100396": "Shared",      "2040100397": "Shared",
  "2040100398": "Shared",      "2040100407": "Shared",
  "2040100410": "Shared",      "2040100413": "Shared",
  "2040100418": "Shared",      "2040100420": "Shared",
  "2040100425": "Shared",      "2040100427": "Shared",
  "2040100431": "Shared",      "2040100446": "Shared",
  "2040100447": "ES400B 2023", "2040100503": "Shared",
  "2040100511": "ES400B 2022", "2040100517": "Shared",
  "2040100519": "Shared",      "2040100567": "Shared",
  "2040100851": "Shared",      "2040200027": "Shared",
  "2040200028": "Shared",      "2040200035": "Shared",
  "2040300038": "Shared",      "2040500041": "Shared",
  "2040500048": "Shared",      "2040500050": "Shared",
  "2040800002": "Shared",      "2040800006": "Shared",
  "2040900041": "Shared",      "2040900049": "Shared",
  "2040900051": "Shared",      "2040900058": "Shared",
  "2040900060": "Shared",      "2041000173": "Shared",
  "2041000174": "Shared",      "2041100098": "ES400B 2022",
  "2042600002": "Shared",      "2042800003": "Shared",
  "2050100009": "Shared",      "3040100652": "ES400B 2022",
  "3040200083": "ES400B 2023", "3040200102": "ES400B 2022",
  "4020000233": "ES400B 2023", "4020000335": "ES400B 2022",
  "4040000165": "ES400B 2022", "4040000236": "ES400B 2023",
  "4040000950": "ES400B 2023", "4040001297": "ES400B 2022",
  "4060000060": "Shared",      "4100000016": "Shared",
  "4190001828": "ES400B 2023",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const MONTH_KEYS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

// Statuses that are terminal: days-open and revenue-lost should not continue
// accruing once a ticket reaches one of these states. (#626)
const TERMINAL_STATUSES = new Set(['Completed', 'Donor']);

export function computeDaysOpen(ticket) {
  if (!ticket.dateEntered) return 0;
  const start = new Date(ticket.dateEntered);
  const end = TERMINAL_STATUSES.has(ticket.status) && ticket.dateCompleted
    ? new Date(ticket.dateCompleted)
    : TERMINAL_STATUSES.has(ticket.status)
      ? new Date(ticket.dateEntered) // no dateCompleted: treat as 0-day span
      : new Date();
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  return Math.max(0, Math.floor((end - start) / 86400000));
}

/**
 * Advance a YYYY-MM-DD date by N units, for recurring maintenance schedules.
 * setMonth/setDate handle month + year rollover. Returns the original string if
 * the date can't be parsed.
 */
export function advanceDueDate(dateStr, unit, n = 1) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  if (unit === 'weeks') d.setDate(d.getDate() + n * 7);
  else if (unit === 'months') d.setMonth(d.getMonth() + n);
  else d.setDate(d.getDate() + n); // 'days' (default)
  return d.toISOString().slice(0, 10);
}

// ── Context ───────────────────────────────────────────────────────────────────
const MaintenanceContext = createContext(null);

export function MaintenanceProvider({ children }) {
  const { orgId } = useOrg();
  // Per-org bootstrap guard: scoped to this provider instance (not module-level) so
  // it resets on unmount/remount (org switch, sign-out). Prevents StrictMode double-write.
  const bootstrappedRef = useRef(new Set());
  const configDocId = orgId ? `${orgId}_maintenance` : null;

  // ── Reads (ADR-0003 org-scoped) ──────────────────────────────────────────
  const { items: tickets, loading: ticketsLoading, error } = useOrgCollection(TICKETS_COL, { limit: MAX_TICKETS });
  const { items: parts, loading: partsLoading } = useOrgCollection(PARTS_COL, { limit: MAX_PARTS });
  const { items: scooters, loading: scootersLoading } = useOrgCollection(SCOOTERS_COL, { limit: MAX_SCOOTERS });
  const { items: schedules, loading: schedulesLoading } = useOrgCollection(SCHEDULES_COL, { limit: MAX_SCHEDULES });
  const { item: configItem, loading: configLoading } = useOrgDoc(CONFIG_COL, configDocId);

  const config = useMemo(() => {
    if (!configItem) return DEFAULT_CONFIG;
    const { _docId, ...rest } = configItem;
    return { ...DEFAULT_CONFIG, ...rest };
  }, [configItem]);

  const loading = ticketsLoading || partsLoading || scootersLoading || configLoading;

  // Bootstrap config defaults once per org.
  useEffect(() => {
    if (configLoading || !configDocId) return;
    if (!configItem && !bootstrappedRef.current.has(configDocId)) {
      bootstrappedRef.current.add(configDocId);
      orgWrite(CONFIG_COL, DEFAULT_CONFIG, { id: configDocId, silent: true });
    }
  }, [configItem, configLoading, configDocId]);

  // ── Computed ──────────────────────────────────────────────────────────────
  const ticketsWithCalc = useMemo(() =>
    tickets.map((t) => {
      const daysOpen  = computeDaysOpen(t);
      const entryDate = t.dateEntered ? new Date(t.dateEntered + 'T12:00:00') : new Date();
      const monthKey  = MONTH_KEYS[entryDate.getMonth()];
      const dailyRate = config.seasonalityIndex?.[monthKey] ?? config.revenueRatePerDay ?? 3.67;
      const revenueLost = daysOpen * dailyRate;
      return { ...t, daysOpen, revenueLost };
    }),
  [tickets, config]);

  const activeTickets   = useMemo(() => ticketsWithCalc.filter((t) => t.status === 'Active'), [ticketsWithCalc]);
  const activeCount     = activeTickets.length;
  // #585 — totalOpenCount matches the Maintenance KPI "Total Open" definition (non-terminal),
  // which includes Backlog, Investigation, Active, Blocked statuses.
  // #626 — Donor (and other terminal statuses) are excluded so they don't inflate
  // open counts or revenue-lost KPIs indefinitely.
  const totalOpenCount  = useMemo(() => ticketsWithCalc.filter((t) => !TERMINAL_STATUSES.has(t.status)).length, [ticketsWithCalc]);
  const isAtMaxActive   = activeCount >= (config.maxActiveTickets ?? 3);
  const totalRevenueLost = useMemo(() =>
    ticketsWithCalc.filter((t) => !TERMINAL_STATUSES.has(t.status)).reduce((s, t) => s + t.revenueLost, 0),
  [ticketsWithCalc]);
  // #625 — exclude Discontinued parts so the low-stock KPI/alert count matches the
  // Parts table, which already filters them out in its local isLow check.
  const lowStockParts   = useMemo(() => parts.filter((p) => p.status !== 'Discontinued' && p.stockOnHand <= p.reorderPoint && p.reorderPoint > 0), [parts]);

  // ── Ticket CRUD ───────────────────────────────────────────────────────────
  const addTicket = useCallback(async (data) => {
    if (!data.scooterId) throw new Error('scooterId is required');
    if (!orgId) throw new Error('addTicket: no active org');
    const dateStr = data.dateEntered || new Date().toISOString().slice(0, 10);
    const scooterId = String(data.scooterId || '').trim();
    const baseId  = orgKey(orgId, scooterId, dateStr);
    // Collision avoidance within the org (multiple tickets same scooter+day).
    const existing = tickets.filter((t) => t._docId === baseId || t._docId?.startsWith(`${baseId}_`));
    const docId   = existing.length === 0 ? baseId : `${baseId}_${existing.length + 1}`;
    await orgWrite(TICKETS_COL, data, { id: docId, rethrow: true, errorMessage: 'Failed to create ticket' });
    return docId;
  }, [tickets, orgId]);

  const updateTicket = useCallback(async (docId, data) => {
    await orgUpdate(TICKETS_COL, docId, data, { rethrow: true, errorMessage: 'Failed to update ticket' });
  }, []);

  const deleteTicket = useCallback(async (docId) => {
    await orgDelete(TICKETS_COL, docId, { rethrow: true, errorMessage: 'Failed to delete ticket' });
  }, []);

  const completeTicket = useCallback(async (docId) => {
    await orgUpdate(TICKETS_COL, docId, {
      status: 'Completed',
      dateCompleted: new Date().toISOString().slice(0, 10),
    }, { rethrow: true, errorMessage: 'Failed to complete ticket' });
  }, []);

  const assignTicket = useCallback(async (docId, uid, displayName) => {
    await orgUpdate(TICKETS_COL, docId, {
      assignedTo:     uid        || null,
      assignedToName: displayName || null,
    }, { rethrow: true, errorMessage: 'Failed to assign ticket' });
  }, []);

  // ── Parts CRUD ────────────────────────────────────────────────────────────
  const addPart = useCallback(async (data) => {
    if (!data.sku) throw new Error('sku is required');
    if (!orgId) throw new Error('addPart: no active org');
    const docId = orgKey(orgId, String(data.sku).trim());
    await orgWrite(PARTS_COL, data, { id: docId, rethrow: true, errorMessage: 'Failed to save part' });
  }, [orgId]);

  const updatePart = useCallback(async (docId, data) => {
    await orgUpdate(PARTS_COL, docId, data, { rethrow: true, errorMessage: 'Failed to update part' });
  }, []);

  const deletePart = useCallback(async (docId) => {
    await orgDelete(PARTS_COL, docId, { rethrow: true, errorMessage: 'Failed to delete part' });
  }, []);

  // ── Config ────────────────────────────────────────────────────────────────
  const updateConfig = useCallback(async (updates) => {
    if (!configDocId) return;
    await orgWrite(CONFIG_COL, { ...config, ...updates }, {
      id: configDocId, rethrow: true, errorMessage: 'Failed to save maintenance config — change reverted',
    });
  }, [config, configDocId]);

  // ── Batch import ──────────────────────────────────────────────────────────
  const importTickets = useCallback(async (rows) => {
    if (!orgId) throw new Error('importTickets: no active org');
    const uid = auth.currentUser?.uid ?? null;
    const existingIds = new Set(tickets.map((t) => t._docId));
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      rows.slice(i, i + BATCH_SIZE).forEach((row) => {
        const scooterId = String(row.scooterId || '').trim();
        const dateStr   = row.dateEntered || new Date().toISOString().slice(0, 10);
        let docId = orgKey(orgId, scooterId, dateStr);
        let suffix = 1;
        while (existingIds.has(docId)) { docId = `${orgKey(orgId, scooterId, dateStr)}_${++suffix}`; }
        existingIds.add(docId);
        batch.set(doc(db, TICKETS_COL, docId), { ...row, orgId, createdByUid: uid, updatedAt: new Date().toISOString() });
      });
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'Ticket import failed mid-batch' });
    }
  }, [tickets, orgId]);

  const importParts = useCallback(async (rows) => {
    if (!orgId) throw new Error('importParts: no active org');
    const uid = auth.currentUser?.uid ?? null;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      rows.slice(i, i + BATCH_SIZE).forEach((row) => {
        const docId = orgKey(orgId, String(row.sku).trim());
        batch.set(doc(db, PARTS_COL, docId), { ...row, orgId, createdByUid: uid, updatedAt: new Date().toISOString() });
      });
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'Parts import failed mid-batch' });
    }
  }, [orgId]);

  // ── Scooter CRUD ─────────────────────────────────────────────────────────────
  const addScooter = useCallback(async (data) => {
    if (!data.scooterId) throw new Error('scooterId is required');
    if (!orgId) throw new Error('addScooter: no active org');
    const docId = orgKey(orgId, String(data.scooterId).trim());
    await orgWrite(SCOOTERS_COL, data, { id: docId, rethrow: true, errorMessage: 'Failed to save scooter' });
  }, [orgId]);

  const updateScooter = useCallback(async (docId, data) => {
    await orgUpdate(SCOOTERS_COL, docId, data, { rethrow: true, errorMessage: 'Failed to update scooter' });
  }, []);

  const deleteScooter = useCallback(async (docId) => {
    await orgDelete(SCOOTERS_COL, docId, { rethrow: true, errorMessage: 'Failed to delete scooter' });
  }, []);

  // ── Scheduled maintenance CRUD (date-based + recurring) ───────────────────────
  const addSchedule = useCallback(async (data) => {
    if (!orgId) throw new Error('addSchedule: no active org');
    if (!data.scooterId) throw new Error('scooterId is required');
    if (!data.nextDue) throw new Error('a due date is required');
    const res = await orgWrite(SCHEDULES_COL, { status: 'active', ...data }, {
      rethrow: true, errorMessage: 'Failed to create schedule',
    });
    return res?.data?.id ?? null;
  }, [orgId]);

  const updateSchedule = useCallback(async (docId, data) => {
    await orgUpdate(SCHEDULES_COL, docId, data, { rethrow: true, errorMessage: 'Failed to update schedule' });
  }, []);

  const deleteSchedule = useCallback(async (docId) => {
    await orgDelete(SCHEDULES_COL, docId, { rethrow: true, errorMessage: 'Failed to delete schedule' });
  }, []);

  // Mark this occurrence serviced: a recurring schedule rolls nextDue forward by its
  // interval (status stays 'active'); a one-off becomes status 'done'. Stamps lastCompleted.
  const markScheduleDone = useCallback(async (docId) => {
    const s = schedules.find((x) => x._docId === docId);
    if (!s) throw new Error('Schedule not found');
    const today = new Date().toISOString().slice(0, 10);
    const recurs = s.recurrence && s.recurrence !== 'none' && Number(s.interval) > 0;
    // #623 — anchor the advance to max(s.nextDue, today) so a late completion always
    // produces a future nextDue rather than remaining in the past.
    const anchor = s.nextDue < today ? today : s.nextDue;
    const patch = recurs
      ? { nextDue: advanceDueDate(anchor, s.recurrence, Number(s.interval)), lastCompleted: today, status: 'active' }
      : { status: 'done', lastCompleted: today };
    await orgUpdate(SCHEDULES_COL, docId, patch, { rethrow: true, errorMessage: 'Failed to update schedule' });
  }, [schedules]);

  // ── Custom tags ───────────────────────────────────────────────────────────────
  const addCustomTag = useCallback(async (type, tag) => {
    const key = type === 'primary' ? 'customPrimaryTags' : 'customSecondaryTags';
    const current = config[key] || [];
    if (current.includes(tag)) return;
    await updateConfig({ [key]: [...current, tag] });
  }, [config, updateConfig]);

  // ── Patch part models from SKU_MODEL_MAP ─────────────────────────────────────
  const patchPartModels = useCallback(async () => {
    for (let i = 0; i < parts.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      parts.slice(i, i + BATCH_SIZE).forEach((p) => {
        const sku = String(p.sku || '').replace(/\.0$/, '').trim();
        const model = SKU_MODEL_MAP[sku] ?? 'Shared';
        batch.update(doc(db, PARTS_COL, p._docId), { model });
      });
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'Part-model patch failed mid-batch' });
    }
  }, [parts]);

  // ── Seed data loader ──────────────────────────────────────────────────────────
  const loadSeedData = useCallback(async () => {
    if (!orgId || !configDocId) throw new Error('loadSeedData: no active org');
    const uid = auth.currentUser?.uid ?? null;

    await orgWrite(CONFIG_COL, SEED_CONFIG, { id: configDocId, rethrow: true, errorMessage: 'Seed: config write failed' });

    for (let i = 0; i < SEED_TICKETS.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      SEED_TICKETS.slice(i, i + BATCH_SIZE).forEach((row) => {
        const scooterId = String(row.scooterId || '').trim();
        const dateStr   = row.dateEntered || new Date().toISOString().slice(0, 10);
        const docId     = orgKey(orgId, scooterId, dateStr);
        batch.set(doc(db, TICKETS_COL, docId), { ...row, orgId, createdByUid: uid, updatedAt: new Date().toISOString() });
      });
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'Seed: tickets batch failed' });
    }

    for (let i = 0; i < SEED_PARTS.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      SEED_PARTS.slice(i, i + BATCH_SIZE).forEach((row) => {
        const docId = orgKey(orgId, String(row.sku).trim());
        batch.set(doc(db, PARTS_COL, docId), { ...row, orgId, createdByUid: uid, updatedAt: new Date().toISOString() });
      });
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'Seed: parts batch failed' });
    }
  }, [orgId, configDocId]);

  // BUG #301 — memoize the context value to prevent unnecessary Firestore reconnects
  const value = useMemo(() => ({
    tickets: ticketsWithCalc,
    parts,
    scooters,
    config,
    loading,
    snapshotError: error ? error.message : null,
    // Computed
    activeTickets,
    activeCount,
    totalOpenCount,
    isAtMaxActive,
    totalRevenueLost,
    lowStockParts,
    // Ticket ops
    addTicket,
    updateTicket,
    deleteTicket,
    completeTicket,
    assignTicket,
    // Scooter ops
    addScooter,
    updateScooter,
    deleteScooter,
    // Schedule ops
    schedules,
    schedulesLoading,
    addSchedule,
    updateSchedule,
    deleteSchedule,
    markScheduleDone,
    // Part ops
    addPart,
    updatePart,
    deletePart,
    // Config
    updateConfig,
    // Import
    importTickets,
    importParts,
    // Custom tags
    addCustomTag,
    // Seed
    loadSeedData,
    patchPartModels,
  }), [
    ticketsWithCalc, parts, scooters, config, loading, error,
    activeTickets, activeCount, totalOpenCount, isAtMaxActive, totalRevenueLost, lowStockParts,
    addTicket, updateTicket, deleteTicket, completeTicket, assignTicket,
    addScooter, updateScooter, deleteScooter,
    schedules, schedulesLoading, addSchedule, updateSchedule, deleteSchedule, markScheduleDone,
    addPart, updatePart, deletePart,
    updateConfig, importTickets, importParts, addCustomTag,
    loadSeedData, patchPartModels,
  ]);

  return (
    <MaintenanceContext.Provider value={value}>
      {children}
    </MaintenanceContext.Provider>
  );
}

export function useMaintenance() {
  const ctx = useContext(MaintenanceContext);
  if (!ctx) throw new Error('useMaintenance must be used inside <MaintenanceProvider>');
  return ctx;
}
