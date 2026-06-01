/**
 * dataLayerConfig — per-collection data-layer routing (ADR-0015).
 *
 * `layerFor(collectionName)` returns 'supabase' | 'firestore' for a given Firestore
 * collection. The seam (useOrgCollection / useOrgDoc / orgWrite*) calls this to pick
 * the backing store per collection, so the operational migration can cut over ONE
 * collection at a time and roll a single collection back without redeploying the rest.
 *
 *   VITE_DATA_LAYER            global default ('firestore' | 'supabase')   — also drives the
 *                              time-series useOrgTable (ADR-0013).
 *   VITE_DATA_LAYER_OVERRIDES  comma list of `collection:layer` pairs, e.g.
 *                              "costs:supabase,issues:supabase" — wins over the global.
 *
 * Both are BUILD-TIME constants (Vite inlines import.meta.env), so layerFor() returns
 * the same value on every render for a given collection — the seam's hook choice is
 * stable and rules-of-hooks holds (same waiver useOrgTable already relies on).
 */

const GLOBAL = (import.meta.env.VITE_DATA_LAYER ?? 'firestore').toLowerCase();

function parseOverrides(raw) {
  const map = {};
  if (!raw) return map;
  for (const pair of String(raw).split(',')) {
    const [coll, layer] = pair.split(':').map((s) => (s ?? '').trim());
    if (coll && (layer === 'supabase' || layer === 'firestore')) map[coll] = layer;
  }
  return map;
}

const OVERRIDES = parseOverrides(import.meta.env.VITE_DATA_LAYER_OVERRIDES);

/** The resolved layer for a Firestore collection name. */
export function layerFor(collectionName) {
  return OVERRIDES[collectionName] ?? GLOBAL;
}

/** True when a collection should read/write Supabase. */
export function isSupabaseLayer(collectionName) {
  return layerFor(collectionName) === 'supabase';
}

export const GLOBAL_DATA_LAYER = GLOBAL;
export const DATA_LAYER_OVERRIDES = Object.freeze({ ...OVERRIDES });
