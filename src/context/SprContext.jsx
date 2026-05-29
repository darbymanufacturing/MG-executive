import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import {
  collection, doc, onSnapshot,
  writeBatch, setDoc, getDocs, query, limit, where,
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';
import {
  NAFPLIO_ZONES,
  NAFPLIO_WEATHER,
  NAFPLIO_EVENTS,
  NAFPLIO_CITY_CENTER,
} from '../utils/nafplioSprData.js';

const EVENTS_COL   = 'sprEvents';
const WEATHER_COL  = 'sprWeather';
const CONFIG_DOC   = 'config/spr';
const BATCH_SIZE   = 450;
// Hard caps on snapshot reads — Phase 1 free-tier defense.
const MAX_EVENTS   = 15000;
const MAX_WEATHER  = 2000;

const DEFAULT_CONFIG = {
  zones:        [],
  cityCenters:  {},
  morningHour:  10,
};

const SprContext = createContext(null);

// Module-level flag: prevents StrictMode double-invoke from writing bootstrap defaults twice
let sprConfigBootstrapped = false;

export function SprProvider({ children }) {
  const [events,        setEvents]        = useState([]);
  const [weather,       setWeather]       = useState([]);
  const [sprConfig,     setSprConfig]     = useState(DEFAULT_CONFIG);
  const [loading,       setLoading]       = useState(true);
  const [snapshotError, setSnapshotError] = useState(null);

  // ── Real-time listeners ───────────────────────────────────────────────────

  useEffect(() => {
    const unsubEvents = onSnapshot(
      query(collection(db, EVENTS_COL), limit(MAX_EVENTS)),
      (snap) => {
        const items = snap.docs.map((d) => ({ _docId: d.id, ...d.data() }));
        setEvents(items);
        setLoading(false);
      },
      (err) => {
        console.error('[SprContext] events snapshot error:', err);
        setSnapshotError(err.message);
      },
    );

    const unsubWeather = onSnapshot(
      query(collection(db, WEATHER_COL), limit(MAX_WEATHER)),
      (snap) => {
        const items = snap.docs.map((d) => ({ _docId: d.id, ...d.data() }));
        setWeather(items);
      },
      (err) => {
        console.error('[SprContext] weather snapshot error:', err);
        setSnapshotError(err.message);
      },
    );

    const unsubConfig = onSnapshot(
      doc(db, CONFIG_DOC),
      (snap) => {
        if (snap.exists()) {
          setSprConfig({ ...DEFAULT_CONFIG, ...snap.data() });
        } else {
          // Bootstrap defaults once — guarded against StrictMode double-fire
          if (!sprConfigBootstrapped) {
            sprConfigBootstrapped = true;
            safeWrite(() => setDoc(doc(db, CONFIG_DOC), DEFAULT_CONFIG), { silent: true });
          }
        }
      },
      (err) => {
        console.error('[SprContext] config snapshot error:', err);
        setSnapshotError(err.message);
      },
    );

    return () => { unsubEvents(); unsubWeather(); unsubConfig(); };
  }, []);

  // ── Config (zones + city centers) ────────────────────────────────────────

  const updateSprConfig = useCallback(async (updates) => {
    const prev = sprConfig;
    const next = { ...sprConfig, ...updates };
    setSprConfig(next); // optimistic
    await safeWrite(
      () => setDoc(doc(db, CONFIG_DOC), next),
      {
        rethrow: true,
        errorMessage: 'Failed to save SPR config — change reverted',
        optimisticRollback: () => setSprConfig(prev),
      },
    );
  }, [sprConfig]);

  // Zone helpers — no optimistic local update; snapshot drives UI to avoid flicker (#45)
  const addZone = useCallback(async (zone) => {
    const id   = `zone_${Date.now()}`;
    const next = { ...sprConfig, zones: [...(sprConfig.zones || []), { ...zone, id }] };
    await safeWrite(
      () => setDoc(doc(db, CONFIG_DOC), next),
      { rethrow: true, errorMessage: 'Failed to add zone' },
    );
  }, [sprConfig]);

  const updateZone = useCallback(async (id, updates) => {
    const next = {
      ...sprConfig,
      zones: (sprConfig.zones || []).map((z) => z.id === id ? { ...z, ...updates } : z),
    };
    await safeWrite(
      () => setDoc(doc(db, CONFIG_DOC), next),
      { rethrow: true, errorMessage: 'Failed to update zone' },
    );
  }, [sprConfig]);

  const deleteZone = useCallback(async (id) => {
    const next = { ...sprConfig, zones: (sprConfig.zones || []).filter((z) => z.id !== id) };
    await safeWrite(
      () => setDoc(doc(db, CONFIG_DOC), next),
      { rethrow: true, errorMessage: 'Failed to delete zone' },
    );
  }, [sprConfig]);

  const setCityCenter = useCallback(async (city, lat, lon) => {
    const next = {
      ...sprConfig,
      cityCenters: { ...(sprConfig.cityCenters || {}), [city]: { lat, lon } },
    };
    await safeWrite(
      () => setDoc(doc(db, CONFIG_DOC), next),
      { rethrow: true, errorMessage: 'Failed to save city center' },
    );
  }, [sprConfig]);

  // ── Event import (chunked batch, upsert by scooterId+datetime docId) ─────

  const importEvents = useCallback(async (rows, city) => {
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach((row) => {
        const docId = `${row.scooterId}_${row.datetime.replace(/[^0-9]/g, '')}`;
        const ref   = doc(db, EVENTS_COL, docId);
        batch.set(ref, { ...row, city: city || row.city || null });
      });
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'SPR batch write failed' });
    }
  }, []);

  const clearEvents = useCallback(async (city = null) => {
    const q = city
      ? query(collection(db, EVENTS_COL), where('city', '==', city))
      : collection(db, EVENTS_COL);
    const snap = await getDocs(q);

    for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'SPR batch write failed' });
    }
  }, []);

  // ── Weather import (upsert by date_city docId) ────────────────────────────

  const importWeather = useCallback(async (days, city) => {
    for (let i = 0; i < days.length; i += BATCH_SIZE) {
      const chunk = days.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach((day) => {
        const docId = `${day.date}_${city}`;
        const ref   = doc(db, WEATHER_COL, docId);
        batch.set(ref, { ...day, city });
      });
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'SPR batch write failed' });
    }
  }, []);

  // ── Nafplio seed data loader ──────────────────────────────────────────────

  const loadNafplioData = useCallback(async () => {
    // 1. Write config (zones + city center)
    const configNext = {
      ...DEFAULT_CONFIG,
      zones: NAFPLIO_ZONES,
      cityCenters: { Nafplio: NAFPLIO_CITY_CENTER },
      morningHour: 10,
    };
    await safeWrite(
      () => setDoc(doc(db, CONFIG_DOC), configNext),
      { rethrow: true, errorMessage: 'Nafplio seed: config write failed' },
    );

    // 2. Import weather
    for (let i = 0; i < NAFPLIO_WEATHER.length; i += BATCH_SIZE) {
      const chunk = NAFPLIO_WEATHER.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach((day) => {
        const docId = `${day.date}_Nafplio`;
        batch.set(doc(db, WEATHER_COL, docId), { ...day, city: 'Nafplio' });
      });
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'Nafplio seed: weather batch failed' });
    }

    // 3. Import events
    for (let i = 0; i < NAFPLIO_EVENTS.length; i += BATCH_SIZE) {
      const chunk = NAFPLIO_EVENTS.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach((row) => {
        const docId = `${row.scooterId}_${row.datetime.replace(/[^0-9]/g, '')}`;
        batch.set(doc(db, EVENTS_COL, docId), { ...row, city: 'Nafplio' });
      });
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'SPR batch write failed' });
    }
  }, []);

  const clearWeather = useCallback(async (city = null) => {
    const snap = await getDocs(collection(db, WEATHER_COL));
    const toDelete = city
      ? snap.docs.filter((d) => d.data().city === city)
      : snap.docs;

    for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      toDelete.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'SPR batch write failed' });
    }
  }, []);

  // BUG #301 — memoize the context value to prevent unnecessary Firestore reconnects
  const value = useMemo(() => ({
    events,
    weather,
    sprConfig,
    loading,
    snapshotError,
    updateSprConfig,
    addZone,
    updateZone,
    deleteZone,
    setCityCenter,
    importEvents,
    clearEvents,
    importWeather,
    clearWeather,
    loadNafplioData,
  }), [
    events, weather, sprConfig, loading, snapshotError,
    updateSprConfig, addZone, updateZone, deleteZone, setCityCenter,
    importEvents, clearEvents, importWeather, clearWeather, loadNafplioData,
  ]);

  return (
    <SprContext.Provider value={value}>
      {children}
    </SprContext.Provider>
  );
}

export function useSpr() {
  const ctx = useContext(SprContext);
  if (!ctx) throw new Error('useSpr must be used inside <SprProvider>');
  return ctx;
}
