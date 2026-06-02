import {
  createContext, useContext, useCallback, useMemo, useState, useEffect,
} from 'react';
import { useOrg } from './OrgContext.jsx';
import { useOrgCollection } from '../hooks/useOrgCollection.js';
import { orgWrite, orgUpdate, orgDelete } from '../hooks/orgWrite.js';

/**
 * FleetContext — FF-3 multi-fleet per org.
 *
 * A fleet ≈ a city. One org can own 2+ fleets (Nafplio, Corinth). This context owns:
 *   - the org's fleet list (Supabase `fleets`, org-scoped via useOrgCollection),
 *   - the ACTIVE fleet (persisted in localStorage; 'all' = the roll-up),
 *   - `scopeByFleet(items)` — the transition-safe filter operational screens use to
 *     show one fleet vs all. Existing operational docs carry `city` (not yet `fleetId`),
 *     so scoping filters by the active fleet's `cities`; 'All Fleets' returns everything.
 *
 * Org-level data (users, owner ledger, loans, org settings) ignores the active fleet —
 * those screens simply don't call scopeByFleet.
 */
const FleetContext = createContext(null);
const ACTIVE_KEY = 'omni_active_fleet';
const ALL = 'all';
const MAX_FLEETS = 100;

export function FleetProvider({ children }) {
  const { orgId } = useOrg();
  const { items: fleets, loading: fleetsLoading } = useOrgCollection('fleets', { limit: MAX_FLEETS });

  const [activeFleetId, setActiveFleetIdState] = useState(() => {
    try { return localStorage.getItem(ACTIVE_KEY) || ALL; } catch { return ALL; }
  });

  // If the persisted active fleet was deleted (or never existed), fall back to All Fleets
  // so the UI can never get stuck pointing at a missing fleet.
  useEffect(() => {
    if (activeFleetId === ALL || fleetsLoading) return;
    if (fleets.length && !fleets.some((f) => f._docId === activeFleetId)) {
      setActiveFleetIdState(ALL);
      try { localStorage.removeItem(ACTIVE_KEY); } catch { /* ignore */ }
    }
  }, [fleets, fleetsLoading, activeFleetId]);

  const setActiveFleet = useCallback((id) => {
    const next = id || ALL;
    setActiveFleetIdState(next);
    try {
      if (next === ALL) localStorage.removeItem(ACTIVE_KEY);
      else localStorage.setItem(ACTIVE_KEY, next);
    } catch { /* ignore */ }
  }, []);

  const isAllFleets = activeFleetId === ALL;
  const activeFleet = useMemo(
    () => (isAllFleets ? null : fleets.find((f) => f._docId === activeFleetId) ?? null),
    [fleets, activeFleetId, isAllFleets],
  );

  // Filter a list of city-bearing operational docs by the active fleet.
  // 'All Fleets' (or a fleet with no cities configured) returns everything unchanged.
  const scopeByFleet = useCallback((items = []) => {
    if (isAllFleets || !activeFleet) return items;
    const cities = (activeFleet.cities ?? []).map((c) => String(c).toLowerCase());
    if (!cities.length) return items;
    return items.filter((it) => it && it.city != null && cities.includes(String(it.city).toLowerCase()));
  }, [isAllFleets, activeFleet]);

  // Which city a given fleet covers, label-friendly (first city or the fleet name).
  const cityToFleet = useMemo(() => {
    const m = new Map();
    for (const f of fleets) for (const c of f.cities ?? []) m.set(String(c).toLowerCase(), f);
    return m;
  }, [fleets]);
  const fleetForCity = useCallback((city) => (city ? cityToFleet.get(String(city).toLowerCase()) ?? null : null), [cityToFleet]);

  const addFleet = useCallback(async (data) => {
    if (!orgId) throw new Error('addFleet: no active org');
    if (!data?.name?.trim()) throw new Error('a fleet name is required');
    const res = await orgWrite('fleets', {
      name: data.name.trim(),
      cities: Array.isArray(data.cities) ? data.cities.filter(Boolean) : [],
      active: data.active !== false,
    }, { rethrow: true, errorMessage: 'Failed to create fleet' });
    return res?.data?.id ?? null;
  }, [orgId]);

  const updateFleet = useCallback(async (docId, patch) => {
    await orgUpdate('fleets', docId, patch, { rethrow: true, errorMessage: 'Failed to update fleet' });
  }, []);

  const deleteFleet = useCallback(async (docId) => {
    await orgDelete('fleets', docId, { rethrow: true, errorMessage: 'Failed to delete fleet' });
    if (docId === activeFleetId) setActiveFleet(ALL);
  }, [activeFleetId, setActiveFleet]);

  const value = useMemo(() => ({
    fleets,
    fleetsLoading,
    activeFleetId,
    activeFleet,
    isAllFleets,
    hasFleets: fleets.length > 0,
    setActiveFleet,
    scopeByFleet,
    fleetForCity,
    addFleet,
    updateFleet,
    deleteFleet,
    ALL_FLEETS: ALL,
  }), [
    fleets, fleetsLoading, activeFleetId, activeFleet, isAllFleets,
    setActiveFleet, scopeByFleet, fleetForCity, addFleet, updateFleet, deleteFleet,
  ]);

  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>;
}

export function useFleet() {
  const ctx = useContext(FleetContext);
  if (!ctx) throw new Error('useFleet must be used inside <FleetProvider>');
  return ctx;
}
