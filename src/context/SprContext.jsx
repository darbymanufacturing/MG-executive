import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  collection, doc, onSnapshot,
  writeBatch, setDoc, getDocs,
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';

const EVENTS_COL   = 'sprEvents';
const WEATHER_COL  = 'sprWeather';
const CONFIG_DOC   = 'config/spr';
const BATCH_SIZE   = 450;

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
    const unsubEvents = onSnapshot(collection(db, EVENTS_COL), (snap) => {
      const items = snap.docs.map((d) => ({ _docId: d.id, ...d.data() }));
      setEvents(items);
      setLoading(false);
    });

    const unsubWeather = onSnapshot(collection(db, WEATHER_COL), (snap) => {
      const items = snap.docs.map((d) => ({ _docId: d.id, ...d.data() }));
      setWeather(items);
    });

    const unsubConfig = onSnapshot(doc(db, CONFIG_DOC), (snap) => {
      if (snap.exists()) {
        setSprConfig({ ...DEFAULT_CONFIG, ...snap.data() });
      } else {
        setDoc(doc(db, CONFIG_DOC), DEFAULT_CONFIG);
      }
    });

    return () => { unsubEvents(); unsubWeather(); unsubConfig(); };
  }, []);

  // ── Config (zones + city centers) ────────────────────────────────────────

  const updateSprConfig = useCallback(async (updates) => {
    const next = { ...sprConfig, ...updates };
    setSprConfig(next); // optimistic
    await setDoc(doc(db, CONFIG_DOC), next);
  }, [sprConfig]);

  // Zone helpers
  const addZone = useCallback(async (zone) => {
    const id   = `zone_${Date.now()}`;
    const next = { ...sprConfig, zones: [...(sprConfig.zones || []), { ...zone, id }] };
    setSprConfig(next);
    await setDoc(doc(db, CONFIG_DOC), next);
  }, [sprConfig]);

  const updateZone = useCallback(async (id, updates) => {
    const next = {
      ...sprConfig,
      zones: (sprConfig.zones || []).map((z) => z.id === id ? { ...z, ...updates } : z),
    };
    setSprConfig(next);
    await setDoc(doc(db, CONFIG_DOC), next);
  }, [sprConfig]);

  const deleteZone = useCallback(async (id) => {
    const next = { ...sprConfig, zones: (sprConfig.zones || []).filter((z) => z.id !== id) };
    setSprConfig(next);
    await setDoc(doc(db, CONFIG_DOC), next);
  }, [sprConfig]);

  const setCityCenter = useCallback(async (city, lat, lon) => {
    const next = {
      ...sprConfig,
      cityCenters: { ...(sprConfig.cityCenters || {}), [city]: { lat, lon } },
    };
    setSprConfig(next);
    await setDoc(doc(db, CONFIG_DOC), next);
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
      await batch.commit();
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
      await batch.commit();
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
      await batch.commit();
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
      await batch.commit();
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
