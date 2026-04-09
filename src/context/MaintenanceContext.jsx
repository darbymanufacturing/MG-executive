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
const CONFIG_DOC   = 'config/maintenance';
const BATCH_SIZE   = 450;

const DEFAULT_CONFIG = {
  revenueRatePerDay: 3.67,
  maxActiveTickets:  3,
  seasonalityIndex: {
    jan: 2.39, feb: 2.68, mar: 3.58, apr: 3.54,
    may: 3.57, jun: 4.83, jul: 5.95, aug: 5.76,
    sep: 3.32, oct: 2.70, nov: 2.34, dec: 3.35,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  const [tickets, setTickets] = useState([]);
  const [parts,   setParts]   = useState([]);
  const [config,  setConfig]  = useState(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);

  // Track which listeners have fired at least once
  const [loaded, setLoaded] = useState({ tickets: false, parts: false, config: false });
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
    const unsubConfig = onSnapshot(doc(db, CONFIG_DOC), (snap) => {
      if (snap.exists()) {
        setConfig({ ...DEFAULT_CONFIG, ...snap.data() });
      } else {
        setDoc(doc(db, CONFIG_DOC), DEFAULT_CONFIG);
      }
      markLoaded('config');
    });
    return () => { unsubTickets(); unsubParts(); unsubConfig(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (loaded.tickets && loaded.parts && loaded.config) setLoading(false);
  }, [loaded]);

  // ── Computed ──────────────────────────────────────────────────────────────
  const ticketsWithCalc = useMemo(() =>
    tickets.map((t) => {
      const daysOpen   = computeDaysOpen(t);
      const revenueLost = daysOpen * (config.revenueRatePerDay ?? 3.67);
      return { ...t, daysOpen, revenueLost };
    }),
  [tickets, config.revenueRatePerDay]);

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
        // Part ops
        addPart,
        updatePart,
        deletePart,
        // Config
        updateConfig,
        // Import
        importTickets,
        importParts,
        // Seed
        loadSeedData,
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
