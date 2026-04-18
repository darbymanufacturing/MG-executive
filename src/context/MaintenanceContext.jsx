import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import {
  collection, doc, onSnapshot,
  setDoc, updateDoc, deleteDoc, writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { SEED_TICKETS, SEED_PARTS, SEED_CONFIG } from '../utils/maintenanceSeedData.js';

// ── Firestore paths ───────────────────────────────────────────────────────────
const TICKETS_COL  = 'maintenanceTickets';
const PARTS_COL    = 'maintenanceParts';
const SCOOTERS_COL = 'scooters';
const CONFIG_DOC   = 'config/maintenance';
const BATCH_SIZE   = 450;

const DEFAULT_CONFIG = {
  revenueRatePerDay: 3.67,
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

export function computeDaysOpen(ticket) {
  if (!ticket.dateEntered) return 0;
  const start = new Date(ticket.dateEntered);
  const end = ticket.status === 'Completed' && ticket.dateCompleted
    ? new Date(ticket.dateCompleted)
    : new Date();
  return Math.max(0, Math.floor((end - start) / 86400000));
}

// ── Context ───────────────────────────────────────────────────────────────────
const MaintenanceContext = createContext(null);

export function MaintenanceProvider({ children }) {
  const [tickets,  setTickets]  = useState([]);
  const [parts,    setParts]    = useState([]);
  const [scooters, setScooters] = useState([]);
  const [config,   setConfig]   = useState(DEFAULT_CONFIG);
  const [loading,  setLoading]  = useState(true);

  // Track which listeners have fired at least once
  const [loaded, setLoaded] = useState({ tickets: false, parts: false, config: false, scooters: false });
  const markLoaded = (key) => setLoaded((prev) => ({ ...prev, [key]: true }));

  // ── Real-time listeners ───────────────────────────────────────────────────
  useEffect(() => {
    const unsubTickets = onSnapshot(collection(db, TICKETS_COL), (snap) => {
      setTickets(snap.docs.map((d) => ({ _docId: d.id, ...d.data() })));
      markLoaded('tickets');
    });
    const unsubParts = onSnapshot(collection(db, PARTS_COL), (snap) => {
      setParts(snap.docs.map((d) => ({ _docId: d.id, ...d.data() })));
      markLoaded('parts');
    });
    const unsubScooters = onSnapshot(collection(db, SCOOTERS_COL), (snap) => {
      setScooters(snap.docs.map((d) => ({ _docId: d.id, ...d.data() })));
      markLoaded('scooters');
    });
    const unsubConfig = onSnapshot(doc(db, CONFIG_DOC), (snap) => {
      if (snap.exists()) {
        setConfig({ ...DEFAULT_CONFIG, ...snap.data() });
      } else {
        setDoc(doc(db, CONFIG_DOC), DEFAULT_CONFIG);
      }
      markLoaded('config');
    });
    return () => { unsubTickets(); unsubParts(); unsubScooters(); unsubConfig(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (loaded.tickets && loaded.parts && loaded.config && loaded.scooters) setLoading(false);
  }, [loaded]);

  // ── Computed ──────────────────────────────────────────────────────────────
  const ticketsWithCalc = useMemo(() =>
    tickets.map((t) => {
      const daysOpen  = computeDaysOpen(t);
      // Use the per-month seasonality rate for the ticket's entry month,
      // falling back to the flat revenueRatePerDay if not configured.
      const entryDate = t.dateEntered ? new Date(t.dateEntered) : new Date();
      const monthKey  = MONTH_KEYS[entryDate.getMonth()];
      const dailyRate = config.seasonalityIndex?.[monthKey] ?? config.revenueRatePerDay ?? 3.67;
      const revenueLost = daysOpen * dailyRate;
      return { ...t, daysOpen, revenueLost };
    }),
  [tickets, config]);

  const activeTickets   = useMemo(() => ticketsWithCalc.filter((t) => t.status === 'Active'), [ticketsWithCalc]);
  const activeCount     = activeTickets.length;
  const isAtMaxActive   = activeCount >= (config.maxActiveTickets ?? 3);
  const totalRevenueLost = useMemo(() =>
    ticketsWithCalc.filter((t) => t.status !== 'Completed').reduce((s, t) => s + t.revenueLost, 0),
  [ticketsWithCalc]);
  const lowStockParts   = useMemo(() => parts.filter((p) => p.stockOnHand <= p.reorderPoint && p.reorderPoint > 0), [parts]);

  // ── Ticket CRUD ───────────────────────────────────────────────────────────
  const addTicket = useCallback(async (data) => {
    const dateStr = data.dateEntered || new Date().toISOString().slice(0, 10);
    const scooterId = String(data.scooterId || '').trim();
    const baseId  = `${scooterId}_${dateStr}`;
    // Collision avoidance
    const existing = tickets.filter((t) => t._docId === baseId || t._docId?.startsWith(`${baseId}_`));
    const docId   = existing.length === 0 ? baseId : `${baseId}_${existing.length + 1}`;
    const now     = new Date().toISOString();
    await setDoc(doc(db, TICKETS_COL, docId), { ...data, createdAt: now, updatedAt: now });
    return docId;
  }, [tickets]);

  const updateTicket = useCallback(async (docId, data) => {
    await updateDoc(doc(db, TICKETS_COL, docId), { ...data, updatedAt: new Date().toISOString() });
  }, []);

  const deleteTicket = useCallback(async (docId) => {
    await deleteDoc(doc(db, TICKETS_COL, docId));
  }, []);

  const completeTicket = useCallback(async (docId) => {
    await updateDoc(doc(db, TICKETS_COL, docId), {
      status: 'Completed',
      dateCompleted: new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString(),
    });
  }, []);

  const assignTicket = useCallback(async (docId, uid, displayName) => {
    await updateDoc(doc(db, TICKETS_COL, docId), {
      assignedTo:     uid        || null,
      assignedToName: displayName || null,
      updatedAt: new Date().toISOString(),
    });
  }, []);

  // ── Parts CRUD ────────────────────────────────────────────────────────────
  const addPart = useCallback(async (data) => {
    const docId = String(data.sku).trim();
    const now   = new Date().toISOString();
    await setDoc(doc(db, PARTS_COL, docId), { ...data, updatedAt: now });
  }, []);

  const updatePart = useCallback(async (docId, data) => {
    await updateDoc(doc(db, PARTS_COL, docId), { ...data, updatedAt: new Date().toISOString() });
  }, []);

  const deletePart = useCallback(async (docId) => {
    await deleteDoc(doc(db, PARTS_COL, docId));
  }, []);

  // ── Config ────────────────────────────────────────────────────────────────
  const updateConfig = useCallback(async (updates) => {
    const next = { ...config, ...updates };
    setConfig(next);
    await setDoc(doc(db, CONFIG_DOC), next);
  }, [config]);

  // ── Batch import ──────────────────────────────────────────────────────────
  const importTickets = useCallback(async (rows) => {
    const existingIds = new Set(tickets.map((t) => t._docId));
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      rows.slice(i, i + BATCH_SIZE).forEach((row) => {
        const scooterId = String(row.scooterId || '').trim();
        const dateStr   = row.dateEntered || new Date().toISOString().slice(0, 10);
        let docId = `${scooterId}_${dateStr}`;
        let suffix = 1;
        while (existingIds.has(docId)) { docId = `${scooterId}_${dateStr}_${++suffix}`; }
        existingIds.add(docId);
        batch.set(doc(db, TICKETS_COL, docId), { ...row, updatedAt: new Date().toISOString() });
      });
      await batch.commit();
    }
  }, [tickets]);

  const importParts = useCallback(async (rows) => {
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      rows.slice(i, i + BATCH_SIZE).forEach((row) => {
        const docId = String(row.sku).trim();
        batch.set(doc(db, PARTS_COL, docId), { ...row, updatedAt: new Date().toISOString() });
      });
      await batch.commit();
    }
  }, []);

  // ── Scooter CRUD ─────────────────────────────────────────────────────────────
  const addScooter = useCallback(async (data) => {
    const docId = String(data.scooterId).trim();
    const now   = new Date().toISOString();
    await setDoc(doc(db, SCOOTERS_COL, docId), { ...data, createdAt: now, updatedAt: now });
  }, []);

  const updateScooter = useCallback(async (docId, data) => {
    await updateDoc(doc(db, SCOOTERS_COL, docId), { ...data, updatedAt: new Date().toISOString() });
  }, []);

  const deleteScooter = useCallback(async (docId) => {
    await deleteDoc(doc(db, SCOOTERS_COL, docId));
  }, []);

  // ── Custom tags ───────────────────────────────────────────────────────────────
  const addCustomTag = useCallback(async (type, tag) => {
    const key = type === 'primary' ? 'customPrimaryTags' : 'customSecondaryTags';
    const current = config[key] || [];
    if (current.includes(tag)) return;
    const updated = [...current, tag];
    const next = { ...config, [key]: updated };
    setConfig(next);
    await updateDoc(doc(db, CONFIG_DOC), { [key]: updated });
  }, [config]);

  // ── Patch part models from SKU_MODEL_MAP ─────────────────────────────────────
  const patchPartModels = useCallback(async () => {
    const allParts = parts; // live snapshot from Firestore listener
    for (let i = 0; i < allParts.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      allParts.slice(i, i + BATCH_SIZE).forEach((p) => {
        const sku = String(p.sku || p._docId || '').replace(/\.0$/, '').trim();
        const model = SKU_MODEL_MAP[sku] ?? 'Shared';
        batch.update(doc(db, PARTS_COL, p._docId), { model });
      });
      await batch.commit();
    }
  }, [parts]);

  // ── Seed data loader ──────────────────────────────────────────────────────────
  const loadSeedData = useCallback(async () => {
    // Write config first
    await setDoc(doc(db, CONFIG_DOC), SEED_CONFIG);

    // Batch-write tickets
    for (let i = 0; i < SEED_TICKETS.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      SEED_TICKETS.slice(i, i + BATCH_SIZE).forEach((row) => {
        const scooterId = String(row.scooterId || '').trim();
        const dateStr   = row.dateEntered || new Date().toISOString().slice(0, 10);
        const docId     = `${scooterId}_${dateStr}`;
        batch.set(doc(db, TICKETS_COL, docId), { ...row, updatedAt: new Date().toISOString() });
      });
      await batch.commit();
    }

    // Batch-write parts
    for (let i = 0; i < SEED_PARTS.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      SEED_PARTS.slice(i, i + BATCH_SIZE).forEach((row) => {
        const docId = String(row.sku).trim();
        batch.set(doc(db, PARTS_COL, docId), { ...row, updatedAt: new Date().toISOString() });
      });
      await batch.commit();
    }
  }, []);

  return (
    <MaintenanceContext.Provider
      value={{
        tickets: ticketsWithCalc,
        parts,
        scooters,
        config,
        loading,
        // Computed
        activeTickets,
        activeCount,
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
      }}
    >
      {children}
    </MaintenanceContext.Provider>
  );
}

export function useMaintenance() {
  const ctx = useContext(MaintenanceContext);
  if (!ctx) throw new Error('useMaintenance must be used inside <MaintenanceProvider>');
  return ctx;
}
