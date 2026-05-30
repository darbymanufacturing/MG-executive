import { createContext, useContext, useEffect, useMemo, useCallback } from 'react';
import {
  collection, doc, writeBatch, getDocs, query, where,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';
import { DEFAULT_SPR_CONFIG } from '../utils/sprConstants.js';
import { NAFPLIO_SPR_DATA } from '../utils/nafplioSprData.js';
import { useOrg } from './OrgContext.jsx';
import { useOrgCollection } from '../hooks/useOrgCollection.js';
import { useOrgDoc } from '../hooks/useOrgDoc.js';
import { orgWrite } from '../hooks/orgWrite.js';

const SPR_EVENTS_COL = 'sprEvents';
const SPR_WEATHER_COL = 'sprWeather';
const SPR_CONFIG_COL = 'config';   // org-scoped singleton: config/${orgId}_spr (was config/spr)
const BATCH_SIZE = 450;
const MAX_SPR_EVENTS = 15000;
const MAX_SPR_WEATHER = 2000;

const SprContext = createContext(null);

// Per-org bootstrap guard (mirrors CostContext): seed defaults once per org.
const bootstrappedSprConfigs = new Set();

export function SprProvider({ children }) {
  const { orgId } = useOrg();
  const configDocId = orgId ? `${orgId}_spr` : null;

  // ── Reads (ADR-0003 org-scoped) ──────────────────────────────────────────
  const { items: events, loading, error } = useOrgCollection(SPR_EVENTS_COL, { limit: MAX_SPR_EVENTS });
  const { items: weather } = useOrgCollection(SPR_WEATHER_COL, { limit: MAX_SPR_WEATHER });
  const { item: configItem, loading: configLoading } = useOrgDoc(SPR_CONFIG_COL, configDocId);

  const sprConfig = useMemo(() => {
    if (!configItem) return DEFAULT_SPR_CONFIG;
    const { _docId, ...rest } = configItem;
    return rest;
  }, [configItem]);

  // First load for an org with no SPR config → seed defaults (org-stamped), once per org.
  useEffect(() => {
    if (configLoading || !configDocId) return;
    if (!configItem && !bootstrappedSprConfigs.has(configDocId)) {
      bootstrappedSprConfigs.add(configDocId);
      orgWrite(SPR_CONFIG_COL, DEFAULT_SPR_CONFIG, { id: configDocId, silent: true });
    }
  }, [configItem, configLoading, configDocId]);

  const updateSprConfig = useCallback(async (updates) => {
    if (!configDocId) return;
    const { updatedAt: _drop, ...base } = sprConfig;
    const next = { ...base, ...updates };
    await orgWrite(SPR_CONFIG_COL, next, {
      id: configDocId, rethrow: true, errorMessage: 'Failed to save SPR config',
    });
  }, [sprConfig, configDocId]);

  const addZone = useCallback(async (zone) => {
    await updateSprConfig({ zones: [...(sprConfig.zones || []), zone] });
  }, [sprConfig, updateSprConfig]);

  const updateZone = useCallback(async (zoneId, updates) => {
    const zones = (sprConfig.zones || []).map((z) => (z.id === zoneId ? { ...z, ...updates } : z));
    await updateSprConfig({ zones });
  }, [sprConfig, updateSprConfig]);

  const deleteZone = useCallback(async (zoneId) => {
    const zones = (sprConfig.zones || []).filter((z) => z.id !== zoneId);
    await updateSprConfig({ zones });
  }, [sprConfig, updateSprConfig]);

  const setCityCenter = useCallback(async (city, coords) => {
    const cityCenters = { ...(sprConfig.cityCenters || {}), [city]: coords };
    await updateSprConfig({ cityCenters });
  }, [sprConfig, updateSprConfig]);

  const importEvents = useCallback(async (rows) => {
    if (!orgId) throw new Error('importEvents: no active org');
    const uid = auth.currentUser?.uid ?? null;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach((row) => {
        const docId = `${row.date}_${row.zoneId || row.city || 'x'}`.replace(/[/.#$[\]]/g, '_');
        batch.set(doc(db, SPR_EVENTS_COL, docId), { ...row, orgId, createdByUid: uid });
      });
      await safeWrite(
        () => batch.commit(),
        { rethrow: true, errorMessage: 'SPR event import failed mid-batch' },
      );
    }
  }, [orgId]);

  const clearEvents = useCallback(async (city) => {
    if (!orgId) throw new Error('clearEvents: no active org');
    const clauses = [where('orgId', '==', orgId)];
    if (city) clauses.push(where('city', '==', city));
    const snap = await getDocs(query(collection(db, SPR_EVENTS_COL), ...clauses));
    for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
      await safeWrite(
        () => batch.commit(),
        { rethrow: true, errorMessage: 'Failed to clear SPR events' },
      );
    }
  }, [orgId]);

  const importWeather = useCallback(async (rows) => {
    if (!orgId) throw new Error('importWeather: no active org');
    const uid = auth.currentUser?.uid ?? null;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach((row) => {
        const docId = `${row.date}_${row.city || 'x'}`.replace(/[/.#$[\]]/g, '_');
        batch.set(doc(db, SPR_WEATHER_COL, docId), { ...row, orgId, createdByUid: uid });
      });
      await safeWrite(
        () => batch.commit(),
        { rethrow: true, errorMessage: 'SPR weather import failed mid-batch' },
      );
    }
  }, [orgId]);

  const clearWeather = useCallback(async (city) => {
    if (!orgId) throw new Error('clearWeather: no active org');
    const clauses = [where('orgId', '==', orgId)];
    if (city) clauses.push(where('city', '==', city));
    const snap = await getDocs(query(collection(db, SPR_WEATHER_COL), ...clauses));
    for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
      await safeWrite(
        () => batch.commit(),
        { rethrow: true, errorMessage: 'Failed to clear SPR weather' },
      );
    }
  }, [orgId]);

  const loadNafplioData = useCallback(async () => {
    await importEvents(NAFPLIO_SPR_DATA.events || []);
    await importWeather(NAFPLIO_SPR_DATA.weather || []);
    if (NAFPLIO_SPR_DATA.config) {
      await updateSprConfig(NAFPLIO_SPR_DATA.config);
    }
  }, [importEvents, importWeather, updateSprConfig]);

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
