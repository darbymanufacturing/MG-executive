/**
 * supabase-admin — server-side SERVICE-ROLE Supabase client + thin identity helpers
 * for the ADR-0023 identity tables (users / organizations / invites).
 *
 * WARNING: this module uses the service-role key, which BYPASSES Row-Level Security.
 * It must only be imported by server-side code (api/ Vercel functions).
 * Never expose supabaseAdmin() or any result to the client.
 *
 * Row shape for all three identity tables (mirrors the operational data layer):
 *   { id uuid, org_id text, source_doc_id text UNIQUE, data jsonb, created_at timestamptz }
 * Client reads back: { _docId: source_doc_id, ...data }
 *
 * This module is also reusable for any other source_doc_id/data table that shares
 * the same row shape (not limited to the three identity tables).
 */

import { createClient } from '@supabase/supabase-js';

// Lazy singleton — null when env vars are unset (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).
let _supa = null;

/**
 * Returns the cached service-role Supabase client, or null if the required env
 * vars (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) are not set.
 * @returns {import('@supabase/supabase-js').SupabaseClient | null}
 */
export function supabaseAdmin() {
  if (_supa) return _supa;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _supa = createClient(url, key, { auth: { persistSession: false } });
  return _supa;
}

/** Throw a clear error when the client is unavailable. */
function requireClient() {
  const client = supabaseAdmin();
  if (!client) {
    throw new Error(
      '[supabase-admin] Supabase client is unavailable — ' +
      'SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY env vars are not set.'
    );
  }
  return client;
}

/** Reshape a raw DB row to the client-expected { _docId, ...data } shape. */
function toDoc(row) {
  if (!row || row.data == null) return null;
  return { _docId: row.source_doc_id, ...row.data };
}

/**
 * Read a single document by its source_doc_id.
 * @param {string} table - Supabase table name
 * @param {string} sourceDocId - the source_doc_id to look up
 * @returns {Promise<{_docId: string, [key: string]: any} | null>}
 */
export async function sbGetDoc(table, sourceDocId) {
  const supa = requireClient();
  const { data, error } = await supa
    .from(table)
    .select('source_doc_id, data')
    .eq('source_doc_id', sourceDocId)
    .maybeSingle();
  if (error) throw new Error(`[supabase-admin] sbGetDoc(${table}, ${sourceDocId}): ${error.message}`);
  return toDoc(data);
}

/**
 * Read all documents for a given org.
 * @param {string} table - Supabase table name
 * @param {string} orgId - the org_id to filter on
 * @returns {Promise<Array<{_docId: string, [key: string]: any}>>}
 */
export async function sbGetByOrg(table, orgId) {
  const supa = requireClient();
  const { data, error } = await supa
    .from(table)
    .select('source_doc_id, data')
    .eq('org_id', orgId);
  if (error) throw new Error(`[supabase-admin] sbGetByOrg(${table}, ${orgId}): ${error.message}`);
  return (data || []).map(toDoc).filter(Boolean);
}

/**
 * Upsert a document (insert or replace on source_doc_id conflict).
 * @param {string} table - Supabase table name
 * @param {string} orgId - the tenant id
 * @param {string} sourceDocId - the idempotency key (Firestore doc id or equivalent)
 * @param {object} docData - the full document payload (stored in the data jsonb column)
 * @returns {Promise<void>}
 */
export async function sbPutDoc(table, orgId, sourceDocId, docData) {
  const supa = requireClient();
  const { error } = await supa
    .from(table)
    .upsert(
      { org_id: orgId, source_doc_id: sourceDocId, data: docData },
      { onConflict: 'source_doc_id' }
    );
  if (error) throw new Error(`[supabase-admin] sbPutDoc(${table}, ${sourceDocId}): ${error.message}`);
}

/**
 * Shallow-merge partial fields into an existing document's data jsonb column.
 * Reads the current row first, merges at the top level of data, then updates.
 * @param {string} table - Supabase table name
 * @param {string} sourceDocId - the source_doc_id to update
 * @param {object} partial - fields to shallow-merge into the existing data object
 * @returns {Promise<void>}
 */
export async function sbPatchDoc(table, sourceDocId, partial) {
  const supa = requireClient();
  // Read current data so we can merge (Supabase has no native jsonb-merge upsert in JS client).
  const { data: row, error: readErr } = await supa
    .from(table)
    .select('data')
    .eq('source_doc_id', sourceDocId)
    .maybeSingle();
  if (readErr) throw new Error(`[supabase-admin] sbPatchDoc read(${table}, ${sourceDocId}): ${readErr.message}`);
  const merged = { ...(row?.data ?? {}), ...partial };
  const { error: writeErr } = await supa
    .from(table)
    .update({ data: merged })
    .eq('source_doc_id', sourceDocId);
  if (writeErr) throw new Error(`[supabase-admin] sbPatchDoc write(${table}, ${sourceDocId}): ${writeErr.message}`);
}

/**
 * Delete a single document by source_doc_id.
 * @param {string} table - Supabase table name
 * @param {string} sourceDocId - the source_doc_id to delete
 * @returns {Promise<void>}
 */
export async function sbDelDoc(table, sourceDocId) {
  const supa = requireClient();
  const { error } = await supa
    .from(table)
    .delete()
    .eq('source_doc_id', sourceDocId);
  if (error) throw new Error(`[supabase-admin] sbDelDoc(${table}, ${sourceDocId}): ${error.message}`);
}

/**
 * Delete all documents belonging to an org (e.g. on org teardown).
 * @param {string} table - Supabase table name
 * @param {string} orgId - the org_id whose rows should be deleted
 * @returns {Promise<number>} count of rows deleted (from PostgREST response headers)
 */
export async function sbDelByOrg(table, orgId) {
  const supa = requireClient();
  const { error, count } = await supa
    .from(table)
    .delete({ count: 'exact' })
    .eq('org_id', orgId);
  if (error) throw new Error(`[supabase-admin] sbDelByOrg(${table}, ${orgId}): ${error.message}`);
  return count ?? 0;
}
