/**
 * supabaseRealtimeBus — a minimal in-process write→read nudge (#575).
 *
 * The Supabase live read hooks (useSupabaseCollectionLive / useSupabaseDocLive) subscribe
 * to Postgres Changes, but the realtime socket runs on the third-party-auth (`accessToken`)
 * bridge and its RLS-gated UPDATE events don't reliably reach the client — so a user's OWN
 * edit (e.g. changing a cost's category) saved fine but didn't reflect in the UI until a
 * manual reload re-fetched. This bus closes that gap WITHOUT touching realtime auth: a
 * successful client write (orgWrite/orgUpdate/orgDelete → supabaseWrite) emits the table
 * name, and the live hooks listening for that table refetch it immediately.
 *
 * Scope: covers the LOCAL writer's own changes (the reported symptom). Cross-client live
 * updates still depend on the realtime stream (a separate follow-up — see BUGS #575).
 *
 * Pure + dependency-free so both the write layer (emit) and the read hooks (subscribe) can
 * import it with no cycle.
 */
const listeners = new Set();

/** Notify listeners that `table` (a Supabase table name) just had a successful write. */
export function emitSupabaseWrite(table) {
  if (!table) return;
  for (const fn of listeners) {
    try { fn(table); } catch { /* a listener error must never break the write that triggered it */ }
  }
}

/** Subscribe to write notifications. Returns an unsubscribe fn. */
export function onSupabaseWrite(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
