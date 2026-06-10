import { createContext, useContext, useEffect, useMemo, useCallback, useRef } from 'react';
import { collection, doc, writeBatch, getDocs, query, where, limit } from 'firebase/firestore';
import { db, auth } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';
import {
  NAFPLIO_ZONES,
  NAFPLIO_WEATHER,
  NAFPLIO_EVENTS,
  NAFPLIO_CITY_CENTER,
} from '../utils/nafplioSprData.js';
import { useOrg } from './OrgContext.jsx';
import { useFleet } from './FleetContext.jsx';
import { useOrgTable } from '../hooks/useSupabaseTable.js';
import { dualWriteSupabase, dualClearSupabase } from '../lib/supabase.js';
import { useOrgDoc } from '../hooks/useOrgDoc.js';
import { orgWrite } from '../hooks/orgWrite.js';
import { orgDocId } from '../utils/orgDocId.js';

const EVENTS_COL   = 'sprEvents';
const SB_EVENTS    = 'spr_events';
const WEATHER_COL  = 'sprWeather';
const SB_WEATHER   = 'spr_weather';
const CONFIG_COL   = 'config';     // org-scoped singleton: config/${orgId}_spr (was config/spr)
const BATCH_SIZE   = 450;
const MAX_EVENTS   = 15000;
const MAX_WEATHER  = 2000;

const DEFAULT_CONFIG = {
  zones:        [],
  cityCenters:  {},
  morningHour:  10,
};

const SprContext = createContext(null);

export function SprProvider({ children }) {
  const { orgId } = useOrg();
  const { fleetForCity } = useFleet();
  // Per-org bootstrap guard: scoped to this provider instance (not module-level) so
  // it resets on unmount/remount (org switch, sign-out). Prevents StrictMode double-write.
  const bootstrappedRef = useRef(new Set());
  const configDocId = orgId ? `${orgId}_spr` : null;

  // ── Reads (ADR-0003 org-scoped) ──────────────────────────────────────────
  // ADR-0013: reads Firestore OR Supabase per VITE_DATA_LAYER (default firestore).
  // #366 — orderBy required so the cap keeps the NEWEST N rows, not an arbitrary slice.
  // Firestore field: 'datetime' (ISO string on every sprEvents doc).
  // Supabase typed column: 'datetime' (confirmed in spr_events table schema).
  const { items: events, loading, error } = useOrgTable(EVENTS_COL, SB_EVENTS, {
    firestore: { orderBy: ['datetime', 'desc'], limit: MAX_EVENTS },
    supabase:  { orderBy: ['datetime', 'desc'], limit: MAX_EVENTS },
  });
  // #366 — orderBy required so the cap keeps the NEWEST N weather rows.
  // Firestore field: 'date' (ISO date string). Supabase typed column: 'weather_date'.
  const { items: weather } = useOrgTable(WEATHER_COL, SB_WEATHER, {
    firestore: { orderBy: ['date', 'desc'],         limit: MAX_WEATHER },
    supabase:  { orderBy: ['weather_date', 'desc'], limit: MAX_WEATHER },
  });
  const { item: configItem, loading: configLoading } = useOrgDoc(CONFIG_COL, configDocId);

  const sprConfig = useMemo(() => {
    if (!configItem) return DEFAULT_CONFIG;
    const { _docId, ...rest } = configItem;
    return { ...DEFAULT_CONFIG, ...rest };
  }, [configItem]);

  // Bootstrap defaults once per org (mirrors the pre-Phase-2 onSnapshot bootstrap).
  useEffect(() => {
    if (configLoading || !configDocId) return;
    if (!configItem && !bootstrappedRef.current.has(configDocId)) {
      bootstrappedRef.current.add(configDocId);
      orgWrite(CONFIG_COL, DEFAULT_CONFIG, { id: configDocId, silent: true });
    }
  }, [configItem, configLoading, configDocId]);

  // Full-doc config write at the org-scoped composite id (matches original setDoc semantics).
  const writeFullConfig = useCallback(async (next, errorMessage) => {
    await orgWrite(CONFIG_COL, next, { id: configDocId, rethrow: true, errorMessage });
  }, [configDocId]);

  // ── Config (zones + city centers) ────────────────────────────────────────
  const updateSprConfig = useCallback(async (updates) => {
    await writeFullConfig({ ...sprConfig, ...updates }, 'Failed to save SPR config');
  }, [sprConfig, writeFullConfig]);

  const addZone = useCallback(async (zone) => {
    const id = `zone_${Date.now()}`;
    await writeFullConfig(
      { ...sprConfig, zones: [...(sprConfig.zones || []), { ...zone, id }] },
      'Failed to add zone',
    );
  }, [sprConfig, writeFullConfig]);

  const updateZone = useCallback(async (id, updates) => {
    await writeFullConfig(
      { ...sprConfig, zones: (sprConfig.zones || []).map((z) => (z.id === id ? { ...z, ...updates } : z)) },
      'Failed to update zone',
    );
  }, [sprConfig, writeFullConfig]);

  const deleteZone = useCallback(async (id) => {
    await writeFullConfig(
      { ...sprConfig, zones: (sprConfig.zones || []).filter((z) => z.id !== id) },
      'Failed to delete zone',
    );
  }, [sprConfig, writeFullConfig]);

  const setCityCenter = useCallback(async (city, lat, lon) => {
    await writeFullConfig(
      { ...sprConfig, cityCenters: { ...(sprConfig.cityCenters || {}), [city]: { lat, lon } } },
      'Failed to save city center',
    );
  }, [sprConfig, writeFullConfig]);

  // ── Event import (chunked batch, upsert by scooterId+datetime docId) ─────
  const importEvents = useCallback(async (rows, city) => {
    if (!orgId) throw new Error('importEvents: no active org');
    const uid = auth.currentUser?.uid ?? null;
    // #559 — resolve fleetId once for the whole import (all rows share the same city).
    const fleet = city ? fleetForCity(city) : null;
    const fleetId = fleet?._docId ?? null;
    const sbEntries = [];
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach((row) => {
        const docId = orgDocId(orgId, row.scooterId, row.datetime.replace(/[^0-9]/g, ''));
        const rowData = {
          ...row,
          city: city || row.city || null,
          orgId,
          createdByUid: uid,
          ...(fleetId ? { fleetId } : {}),
        };
        batch.set(doc(db, EVENTS_COL, docId), rowData);
        sbEntries.push({ id: docId, data: rowData });
      });
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'SPR batch write failed' });
    }
    // ADR-0013: mirror to Supabase (best-effort; never blocks the Firestore write).
    await dualWriteSupabase(EVENTS_COL, orgId, sbEntries);
  }, [orgId, fleetForCity]);

  const clearEvents = useCallback(async (city = null) => {
    if (!orgId) throw new Error('clearEvents: no active org');
    const clauses = [where('orgId', '==', orgId)];
    if (city) clauses.push(where('city', '==', city));
    // Paginated delete to avoid OOM on large collections (bug-73).
    let more = true;
    while (more) {
      // eslint-disable-next-line no-await-in-loop
      const snap = await getDocs(query(collection(db, EVENTS_COL), ...clauses, limit(BATCH_SIZE)));
      if (snap.empty) break;
      const batch = writeBatch(db);
      snap.docs.forEach((d) => batch.delete(d.ref));
      // eslint-disable-next-line no-await-in-loop
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'SPR batch write failed' });
      more = snap.docs.length === BATCH_SIZE;
    }
    // ADR-0013: mirror the clear to Supabase so the read store stays in sync (#620).
    await dualClearSupabase(EVENTS_COL, orgId, city ? [['city', '==', city]] : []);
  }, [orgId]);

  // ── Weather import (upsert by date_city docId) ────────────────────────────
  const importWeather = useCallback(async (days, city) => {
    if (!orgId) throw new Error('importWeather: no active org');
    const uid = auth.currentUser?.uid ?? null;
    // #559 — resolve fleetId once for the whole import.
    const fleet = city ? fleetForCity(city) : null;
    const fleetId = fleet?._docId ?? null;
    const sbEntries = [];
    for (let i = 0; i < days.length; i += BATCH_SIZE) {
      const chunk = days.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach((day) => {
        const docId = orgDocId(orgId, day.date, city);
        const rowData = { ...day, city, orgId, createdByUid: uid, ...(fleetId ? { fleetId } : {}) };
        batch.set(doc(db, WEATHER_COL, docId), rowData);
        sbEntries.push({ id: docId, data: rowData });
      });
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'SPR batch write failed' });
    }
    // ADR-0013: mirror to Supabase (best-effort; never blocks the Firestore write).
    await dualWriteSupabase(WEATHER_COL, orgId, sbEntries);
  }, [orgId, fleetForCity]);

  const clearWeather = useCallback(async (city = null) => {
    if (!orgId) throw new Error('clearWeather: no active org');
    const clauses = [where('orgId', '==', orgId)];
    if (city) clauses.push(where('city', '==', city));
    // Paginated delete to avoid OOM on large collections (bug-73).
    let more = true;
    while (more) {
      // eslint-disable-next-line no-await-in-loop
      const snap = await getDocs(query(collection(db, WEATHER_COL), ...clauses, limit(BATCH_SIZE)));
      if (snap.empty) break;
      const batch = writeBatch(db);
      snap.docs.forEach((d) => batch.delete(d.ref));
      // eslint-disable-next-line no-await-in-loop
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'SPR batch write failed' });
      more = snap.docs.length === BATCH_SIZE;
    }
    // ADR-0013: mirror the clear to Supabase so the read store stays in sync (#620).
    await dualClearSupabase(WEATHER_COL, orgId, city ? [['city', '==', city]] : []);
  }, [orgId]);

  // ── Nafplio seed data loader ──────────────────────────────────────────────
  const loadNafplioData = useCallback(async () => {
    if (!orgId) throw new Error('loadNafplioData: no active org');
    const uid = auth.currentUser?.uid ?? null;
    // #559 — stamp fleetId for the hardcoded Nafplio seed data.
    const nafplioFleet = fleetForCity('Nafplio');
    const nafplioFleetId = nafplioFleet?._docId ?? null;
    const fleetPatch = nafplioFleetId ? { fleetId: nafplioFleetId } : {};

    // 1. Config (zones + city center)
    await writeFullConfig({
      ...DEFAULT_CONFIG,
      zones: NAFPLIO_ZONES,
      cityCenters: { Nafplio: NAFPLIO_CITY_CENTER },
      morningHour: 10,
    }, 'Nafplio seed: config write failed');

    // 2. Weather
    const sbWeatherEntries = [];
    for (let i = 0; i < NAFPLIO_WEATHER.length; i += BATCH_SIZE) {
      const chunk = NAFPLIO_WEATHER.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach((day) => {
        const docId = orgDocId(orgId, day.date, 'Nafplio');
        const rowData = { ...day, city: 'Nafplio', orgId, createdByUid: uid, ...fleetPatch };
        batch.set(doc(db, WEATHER_COL, docId), rowData);
        sbWeatherEntries.push({ id: docId, data: rowData });
      });
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'Nafplio seed: weather batch failed' });
    }
    // ADR-0013: mirror to Supabase (best-effort; never blocks the Firestore write).
    await dualWriteSupabase(WEATHER_COL, orgId, sbWeatherEntries);

    // 3. Events
    const sbEventEntries = [];
    for (let i = 0; i < NAFPLIO_EVENTS.length; i += BATCH_SIZE) {
      const chunk = NAFPLIO_EVENTS.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach((row) => {
        const docId = orgDocId(orgId, row.scooterId, row.datetime.replace(/[^0-9]/g, ''));
        const rowData = { ...row, city: 'Nafplio', orgId, createdByUid: uid, ...fleetPatch };
        batch.set(doc(db, EVENTS_COL, docId), rowData);
        sbEventEntries.push({ id: docId, data: rowData });
      });
      await safeWrite(() => batch.commit(), { rethrow: true, errorMessage: 'SPR batch write failed' });
    }
    // ADR-0013: mirror to Supabase (best-effort; never blocks the Firestore write).
    await dualWriteSupabase(EVENTS_COL, orgId, sbEventEntries);
  }, [orgId, fleetForCity, writeFullConfig]);

  const value = useMemo(() => ({
    events, weather, sprConfig, loading, snapshotError: error ? error.message : null,
    updateSprConfig, addZone, updateZone, deleteZone, setCityCenter,
    importEvents, clearEvents, importWeather, clearWeather, loadNafplioData,
  }), [events, weather, sprConfig, loading, error,
      updateSprConfig, addZone, updateZone, deleteZone, setCityCenter,
      importEvents, clearEvents, importWeather, clearWeather, loadNafplioData]);

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
