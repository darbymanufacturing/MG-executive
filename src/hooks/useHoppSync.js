import { useState, useCallback, useEffect } from 'react';
import { auth } from '../lib/firebase.js';
import { supabase, isSupabaseConfigured } from '../lib/supabase.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useOrg } from '../context/OrgContext.jsx';

/**
 * useHoppSync — drives the Refresh button in TopBar + the Hopp Sync section
 * in Settings. Two responsibilities:
 *
 *   1. `refresh()` triggers a manual sync by POSTing the user's Firebase ID
 *      token to `/api/hopp-refresh`, which proxies to the always-on hopp-sync
 *      worker's `/sync/trigger`. Shows a success/error toast with the counts.
 *   2. `lastSync`/`recentSyncs` read the 10 most recent Supabase
 *      `hopp_sync_runs` rows (the worker logs every run there) — fetched on
 *      mount and re-fetched after each manual refresh; no realtime needed.
 *
 * Returns:
 *   refresh()       — async, throws nothing; toast handles failure
 *   syncing         — true while a refresh is in flight
 *   lastSync        — latest run (normalized) or null
 *   recentSyncs     — last 10 runs (for the Settings panel)
 */

// hopp_sync_runs row → the shape the TopBar/Settings consumers render.
// counts {trips, status, repairs, revenue} maps onto the legacy
// written {trips, events, tickets} fields so the panel keeps working.
function mapRun(row) {
  const counts = row.counts || {};
  return {
    id: row.id,
    trigger: row.trigger,
    ok: row.ok,
    durationMs: row.duration_ms,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    written: {
      trips: counts.trips || 0,
      events: counts.status || 0,
      tickets: counts.repairs || 0,
      revenueDays: counts.revenue || 0,
    },
    errors: Array.isArray(row.errors) ? row.errors : [],
  };
}

export default function useHoppSync() {
  const { success, error: errorToast, info } = useToast();
  const { getIdToken } = useAuth();
  const { orgId } = useOrg();
  const [syncing, setSyncing] = useState(false);
  const [recentSyncs, setRecentSyncs] = useState([]);
  const [lastSync, setLastSync] = useState(null);

  const fetchRuns = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !orgId) return;
    const { data, error } = await supabase
      .from('hopp_sync_runs')
      .select('*')
      .eq('org_id', orgId)
      .order('started_at', { ascending: false })
      .limit(10);
    if (error) {
      // Silent (matches the old first-run/no-logs behavior) — panel just stays empty.
      console.warn('[useHoppSync] hopp_sync_runs fetch error', error.message);
      return;
    }
    const rows = (data || []).map(mapRun);
    setRecentSyncs(rows);
    setLastSync(rows[0] || null);
  }, [orgId]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const refresh = useCallback(async () => {
    if (syncing) return;
    if (!auth.currentUser) {
      errorToast('You must be signed in to refresh');
      return;
    }
    setSyncing(true);
    try {
      const idToken = await getIdToken();
      const res = await fetch('/api/hopp-refresh', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${idToken}` },
      });
      const body = await res.json().catch(() => ({}));

      if (body.skipped) {
        info('A Hopp sync is already running — check back in a minute.');
        await fetchRuns();
        return;
      }
      if (body.pending) {
        info(body.message || 'Sync still running — check the Hopp panel shortly.');
        return;
      }
      if (!res.ok || !body.ok) {
        const firstErr = body.errors?.[0];
        const msg = body.error
          || (typeof firstErr === 'string' ? firstErr : firstErr?.error)
          || `Sync failed (${res.status})`;
        errorToast(`Sync failed: ${msg}`);
        return;
      }

      const c = body.counts || {};
      const totalNew = (c.trips || 0) + (c.status || 0) + (c.repairs || 0) + (c.revenue || 0);
      const errs = body.errors?.length || 0;
      const summary = totalNew > 0
        ? `Synced ${c.trips || 0} trips, ${c.status || 0} status events, ${c.repairs || 0} repairs`
        : 'Up to date — nothing new from Hopp';
      success(errs > 0 ? `${summary} (${errs} warnings)` : summary);
      await fetchRuns();
    } catch (err) {
      errorToast(`Sync failed: ${err?.message || err}`);
    } finally {
      setSyncing(false);
    }
    // success/errorToast/info are stable from ToastContext
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncing, fetchRuns]);

  return { refresh, syncing, lastSync, recentSyncs };
}
