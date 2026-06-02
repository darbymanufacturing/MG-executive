import { describe, it, expect, vi, afterEach } from 'vitest';

// dataLayerConfig reads import.meta.env at module-load, so each case re-imports the
// module with a fresh env (vi.resetModules + vi.stubEnv → re-eval). (ADR-0015.)
async function loadWith(env = {}) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import('./dataLayerConfig.js');
}

afterEach(() => vi.unstubAllEnvs());

describe('layerFor (ADR-0015 per-collection routing)', () => {
  it('defaults to supabase when nothing is set (post-cutover default)', async () => {
    const { layerFor } = await loadWith({});
    expect(layerFor('costs')).toBe('supabase');
    expect(layerFor('anything')).toBe('supabase');
  });

  it('honours an explicit global VITE_DATA_LAYER (can force firestore back)', async () => {
    const { layerFor } = await loadWith({ VITE_DATA_LAYER: 'firestore' });
    expect(layerFor('costs')).toBe('firestore');
  });

  it('is case/space-insensitive on the global value', async () => {
    const { layerFor } = await loadWith({ VITE_DATA_LAYER: '  SUPABASE ' });
    expect(layerFor('costs')).toBe('supabase');
  });

  it('a per-collection override WINS over the global', async () => {
    const { layerFor } = await loadWith({
      VITE_DATA_LAYER: 'firestore',
      VITE_DATA_LAYER_OVERRIDES: 'costs:supabase,issues:supabase',
    });
    expect(layerFor('costs')).toBe('supabase');
    expect(layerFor('issues')).toBe('supabase');
    expect(layerFor('projects')).toBe('firestore'); // not overridden → global
  });

  it('an override can pin a single collection BACK to firestore (rollback)', async () => {
    const { layerFor } = await loadWith({
      VITE_DATA_LAYER: 'supabase',
      VITE_DATA_LAYER_OVERRIDES: 'maintenanceTickets:firestore',
    });
    expect(layerFor('maintenanceTickets')).toBe('firestore');
    expect(layerFor('costs')).toBe('supabase');
  });

  it('falls back to supabase (with a console.error) on an invalid global — #492', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { layerFor } = await loadWith({ VITE_DATA_LAYER: 'firestre' }); // typo
    expect(layerFor('costs')).toBe('supabase');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('VITE_DATA_LAYER'));
    spy.mockRestore();
  });

  it('ignores malformed override pairs (bad layer, empty collection)', async () => {
    const { layerFor } = await loadWith({
      VITE_DATA_LAYER_OVERRIDES: 'costs:bogus, :supabase , issues:supabase',
    });
    expect(layerFor('costs')).toBe('supabase'); // 'bogus' layer rejected → falls through to the (supabase) default
    expect(layerFor('issues')).toBe('supabase'); // whitespace trimmed, valid
  });

  it('isSupabaseLayer mirrors layerFor', async () => {
    const { isSupabaseLayer } = await loadWith({ VITE_DATA_LAYER: 'firestore', VITE_DATA_LAYER_OVERRIDES: 'costs:supabase' });
    expect(isSupabaseLayer('costs')).toBe(true);    // overridden → supabase
    expect(isSupabaseLayer('projects')).toBe(false); // global firestore
  });
});
