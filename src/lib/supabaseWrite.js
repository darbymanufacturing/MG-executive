/**
 * supabaseWrite — the Supabase write half of the ADR-0015 seam. Mirrors the
 * orgWrite/orgUpdate/orgDelete/orgTransaction contracts so the locked primitives
 * can delegate to it with zero change to their public behaviour:
 *   - create/upsert stamps orgId/createdByUid/createdAt/updatedAt as CONCRETE values
 *     (Postgres has no serverTimestamp; ISO strings match docs/SCHEMA.md), returns
 *     `{ id }` so callers' `result.data.id` keeps working.
 *   - update → apply_doc_patch RPC (shallow `data || patch`), with Firestore
 *     arrayUnion(...) sentinels translated to the `$append` directive.
 *   - transaction → rmw_read/rmw_commit optimistic-CAS loop (projects only).
 * Writes are direct to Supabase (ADR-0015 = fully off Firestore); RLS + the RPCs'
 * internal org guard enforce tenant isolation.
 */
import { supabase } from './supabase.js';
import { SUPABASE_TABLE, toSupabaseRow, jsonbSafe } from './supabaseRowMap.js';

function tableFor(collectionName) {
  const t = SUPABASE_TABLE[collectionName];
  if (!t) throw new Error(`supabaseWrite: no Supabase table mapped for "${collectionName}"`);
  return t;
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Fallback (non-secure) — only hit in environments without WebCrypto.
  return 'id-' + Math.abs(Date.now() ^ Math.floor(performance?.now?.() ?? 0)).toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
}

/** Normalize a supabase-js error into an Error with a friendly message. */
export function friendlySupabaseError(error, fallback = 'Could not save your change.') {
  if (!error) return new Error(fallback);
  const msg = error.message || fallback;
  if (/duplicate key|already exists/i.test(msg)) return new Error('That record already exists.');
  if (/row-level security|rls|permission/i.test(msg)) return new Error('You do not have access to that record.');
  if (/not found/i.test(msg)) return new Error('That record no longer exists.');
  return new Error(msg);
}

/**
 * Split an orgUpdate patch into a plain shallow-merge object + a `$append` map for
 * Firestore arrayUnion sentinels (apply_doc_patch appends those to the existing array).
 * Other FieldValue sentinels (serverTimestamp etc.) are dropped, consistent with
 * jsonbSafe; nested values are normalized via jsonbSafe.
 */
export function prepareSupabasePatch(patch) {
  const plain = {};
  const append = {};
  for (const k of Object.keys(patch ?? {})) {
    const v = patch[k];
    if (v && typeof v === 'object' && v._methodName) {
      if (String(v._methodName).includes('arrayUnion')) {
        // Firebase stores the elements on the sentinel; jsonbSafe-normalize each.
        const els = Array.isArray(v._elements) ? v._elements : [];
        append[k] = els.map(jsonbSafe);
      }
      // arrayRemove / serverTimestamp / increment are not used by operational
      // orgUpdate call-sites; drop them (matches jsonbSafe dropping sentinels).
      continue;
    }
    plain[k] = jsonbSafe(v);
  }
  return { plain, append: Object.keys(append).length ? append : null };
}

/**
 * Create (auto id) or upsert (explicit opts.id) into Supabase.
 * @returns {Promise<{id:string}>}
 */
export async function sbWrite(collectionName, orgId, userUid, data, opts = {}) {
  if (!supabase) throw new Error('supabaseWrite: Supabase client not configured.');
  const table = tableFor(collectionName);
  const id = opts.id ?? newId();
  const stamped = {
    ...data,
    createdByUid: data.createdByUid ?? userUid ?? null,
    createdAt: data.createdAt ?? new Date().toISOString(),
    updatedAt: data.updatedAt ?? new Date().toISOString(),
  };
  const row = toSupabaseRow(collectionName, orgId, id, stamped);
  const { error } = await supabase.from(table).upsert(row, { onConflict: 'source_doc_id' });
  if (error) throw friendlySupabaseError(error, `Failed to save ${collectionName}`);
  return { id };
}

/**
 * Create-or-merge at an explicit id — the Supabase equivalent of Firestore
 * setDoc(merge:true) used by the singleton config docs. Tries a shallow data-merge
 * (apply_doc_patch); if the row doesn't exist yet, inserts the full doc. Avoids the
 * data-clobbering a plain upsert would cause (it replaces the whole jsonb).
 */
export async function sbUpsertMerge(collectionName, orgId, userUid, id, data) {
  if (!supabase) throw new Error('supabaseWrite: Supabase client not configured.');
  const table = tableFor(collectionName);
  const { plain, append } = prepareSupabasePatch(data);
  const p_patch = append ? { ...plain, $append: append } : plain;
  const { error } = await supabase.rpc('apply_doc_patch', { p_table: table, p_source_doc_id: id, p_patch });
  if (!error) return { id };
  if (/not found/i.test(error.message || '')) {
    return sbWrite(collectionName, orgId, userUid, data, { id }); // first write — insert full doc
  }
  throw friendlySupabaseError(error, `Failed to save ${collectionName}`);
}

/** Patch a doc (shallow `data || patch`, arrayUnion→$append) via the apply_doc_patch RPC. */
export async function sbUpdate(collectionName, orgId, docId, patch) {
  if (!supabase) throw new Error('supabaseWrite: Supabase client not configured.');
  const table = tableFor(collectionName);
  const { plain, append } = prepareSupabasePatch(patch);
  const p_patch = append ? { ...plain, $append: append } : plain;
  const { error } = await supabase.rpc('apply_doc_patch', {
    p_table: table, p_source_doc_id: docId, p_patch,
  });
  if (error) throw friendlySupabaseError(error, `Failed to update ${collectionName}`);
  return { id: docId };
}

/** Delete a doc by source_doc_id (org-scoped). */
export async function sbDelete(collectionName, orgId, docId) {
  if (!supabase) throw new Error('supabaseWrite: Supabase client not configured.');
  const table = tableFor(collectionName);
  const { error } = await supabase.from(table).delete().eq('org_id', orgId).eq('source_doc_id', docId);
  if (error) throw friendlySupabaseError(error, `Failed to delete ${collectionName}`);
  return { id: docId };
}

/**
 * Optimistic read-modify-write transaction via rmw_read/rmw_commit (projects only).
 * Mirrors orgTransaction: `mutator(currentData)` returns the top-level patch to merge.
 * Retries up to 5× on a lost version-CAS race (matches Firestore's 5 retries).
 */
export async function sbTransaction(collectionName, orgId, docId, mutator) {
  if (!supabase) throw new Error('supabaseWrite: Supabase client not configured.');
  const table = tableFor(collectionName);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: read, error: rErr } = await supabase.rpc('rmw_read', {
      p_table: table, p_source_doc_id: docId,
    });
    if (rErr) throw friendlySupabaseError(rErr, `Failed to read ${collectionName}`);
    if (!read?.found) throw new Error(`Transaction on ${collectionName}/${docId}: document not found.`);
    const patch = await mutator(read.data ?? {});
    const cleanPatch = jsonbSafe(patch ?? {});
    const { data: rows, error: cErr } = await supabase.rpc('rmw_commit', {
      p_table: table, p_source_doc_id: docId, p_patch: cleanPatch, p_expected_version: read.version ?? 0,
    });
    if (cErr) throw friendlySupabaseError(cErr, `Failed to commit ${collectionName}`);
    if ((rows ?? 0) > 0) return; // committed
    // rows === 0 → another writer won the version race; re-read and retry.
  }
  throw new Error(`Transaction on ${collectionName}/${docId} contended — exceeded 5 retries.`);
}
