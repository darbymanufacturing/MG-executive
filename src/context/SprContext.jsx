import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  collection, doc, onSnapshot,
  writeBatch, setDoc, getDocs, query, limit,
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

export function SprProvider({ children }) {
  const [events,      setEvents]      = useState([]);
  const [weather,     setWeather]     = useState([]);
  const [sprConfig,   setSprConfig]   = useState(DEFAULT_CONFIG);
  const [loading,     setLoading]     = useState(true);

  // ── Real-time listeners ───────────────────────────────────────────────────

  useEffect(() => {
    const unsubEvents = onSnapshot(
      query(collection(db, EVENTS_COL), limit(MAX_EVENTS)),
      (snap) => {
        const items = snap.docs.map((d) => ({ _docId: d.id, ...d.data() }));
        setEvents(items);
        setLoading(false);
      },
    );

    const unsubWeather = onSnapshot(
      query(collection(db, WEATHER_COL), limit(MAX_WEATHER)),
      (snap) => {
        const items = snap.docs.map((d) => ({ _docId: d.id, ...d.data() }));
        setWeather(items);
      },
    );

    const unsubConfig = onSnapshot(doc(db, CONFIG_DOC), (snap) => {
      if (snap.exists()) {
        setSprConfig({ ...DEFAULT_CONFIG, ...snap.data() });
      } else {
        safeWrite(() => setDoc(doc(db, CONFIG_DOC), DEFAULT_CONFIG), { silent: true });
      }
    });

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

  // Zone helpers
  const addZone = useCallback(async (zone) => {
    const prev = sprConfig;
    const id   = `zone_${Date.now()}`;
    const next = { ...sprConfig, zones: [...(sprConfig.zones || []), { ...zone, id }] };
    setSprConfig(next);
    await safeWrite(
      () => setDoc(doc(db, CONFIG_DOC), next),
      {
        rethrow: true,
        errorMessage: 'Failed to add zone — change reverted',
        optimisticRollback: () => setSprConfig(prev),
      },
    );
  }, [sprConfig]);

  const updateZone = useCallback(async (id, updates) => {
    const prev = sprConfig;
    const next = {
      ...sprConfig,
      zones: (sprConfig.zones || []).map((z) => z.id === id ? { ...z, ...updates } : z),
    };
    setSprConfig(next);
    await safeWrite(
      () => setDoc(doc(db, CONFIG_DOC), next),
      {
        rethrow: true,
        errorMessage: 'Failed to update zone — change reverted',
        optimisticRollback: () => setSprConfig(prev),
      },
    );
  }, [sprConfig]);

  const deleteZone = useCallback(async (id) => {
    const prev = sprConfig;
    const next = { ...sprConfig, zones: (sprConfig.zones || []).filter((z) => z.id !== id) };
    setSprConfig(next);
    await safeWrite(
      () => setDoc(doc(db, CONFIG_DOC), next),
      {
        rethrow: true,
        errorMessage: 'Failed to delete zone — change reverted',
        optimisticRollback: () => setSprConfig(prev),
      },
    );
  }, [sprConfig]);

  const setCityCenter = useCallback(async (city, lat, lon) => {
    const prev = sprConfig;
    const next = {
      ...sprConfig,
      cityCenters: { ...(sprConfig.cityCenters || {}), [city]: { lat, lon } },
    };
    setSprConfig(next);
    await safeWrite(
      () => setDoc(doc(db, CONFIG_DOC), next),
      {
        rethrow: true,
        errorMessage: 'Failed to save city center — change reverted',
        optimisticRollback: () => setSprConfig(prev),
      },
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
    const snap = await getDocs(collection(db, EVENTS_COL));
    const toDelete = city
      ? snap.docs.filter((d) => d.data().city === city)
      : snap.docs;

    for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      toDelete.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
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

  return (
    <SprContext.Provider
      value={{
        events,
        weather,
        sprConfig,
        loading,
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
      }}
    >
      {children}
    </SprContext.Provider>
  );
}

export function useSpr() {
  const ctx = useContext(SprContext);
  if (!ctx) throw new Error('useSpr must be used inside <SprProvider>');
  return ctx;
}
