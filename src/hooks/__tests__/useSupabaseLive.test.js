/**
 * useSupabaseLive — realtime channel lifecycle (#710).
 *
 * The fake client below mirrors the two realtime-js 2.106 behaviours that took
 * the app down in production:
 *   1. `client.channel(name)` returns the EXISTING channel when the name matches;
 *   2. `.on('postgres_changes')` throws on a channel that was already subscribed.
 * `removeChannel` is asynchronous in the real client, so a removed channel stays
 * registered here — exactly the window a re-running effect lands in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const h = vi.hoisted(() => {
  const state = { channels: new Map(), rows: [], failChannel: false };
  const makeBuilder = () => {
    const b = {
      select: () => b,
      eq: () => b,
      order: () => b,
      range: () => b,
      maybeSingle: () => Promise.resolve({ data: state.rows[0] ?? null, error: null }),
      then: (resolve, reject) => Promise.resolve({ data: state.rows, error: null }).then(resolve, reject),
    };
    return b;
  };
  const client = {
    from: () => makeBuilder(),
    channel: (name) => {
      if (state.failChannel) throw new Error('realtime unavailable');
      const existing = state.channels.get(name);
      if (existing) return existing;
      const ch = {
        name,
        subscribed: false,
        on() {
          if (ch.subscribed) {
            throw new Error(`cannot add \`postgres_changes\` callbacks for realtime:${name} after \`subscribe()\`.`);
          }
          return ch;
        },
        subscribe() { ch.subscribed = true; return ch; },
      };
      state.channels.set(name, ch);
      return ch;
    },
    removeChannel: vi.fn(() => Promise.resolve('ok')),
  };
  return { state, client };
});

vi.mock('../../lib/supabase.js', () => ({ supabase: h.client, isSupabaseConfigured: true }));
vi.mock('../../context/OrgContext.jsx', () => ({
  useOrg: () => ({ orgId: 'org-1', loading: false, hasUser: true }),
}));
vi.mock('../useSupabaseTable.js', () => ({
  mapRow: (r) => (r ? { _docId: r.source_doc_id, ...(r.data || {}) } : null),
  OP_MAP: { '==': 'eq' },
}));

import { useSupabaseCollectionLive, useSupabaseDocLive } from '../useSupabaseLive.js';
import { emitSupabaseWrite } from '../../lib/supabaseRealtimeBus.js';

const userRow = { source_doc_id: 'u1', org_id: 'org-1', data: { displayName: 'A' } };

beforeEach(() => {
  h.state.channels.clear();
  h.state.rows = [];
  h.state.failChannel = false;
  h.client.removeChannel.mockClear();
});

describe('useSupabaseCollectionLive — one realtime channel per subscription (#710)', () => {
  it('two readers of the same table with the same options do not share a channel', async () => {
    h.state.rows = [userRow];
    const a = renderHook(() => useSupabaseCollectionLive('users', {}));
    // The second reader is what crashed the app: same table, same options.
    const b = renderHook(() => useSupabaseCollectionLive('users', {}));

    await waitFor(() => expect(b.result.current.loading).toBe(false));
    expect(h.state.channels.size).toBe(2);
    expect(a.result.current.items).toHaveLength(1);
    expect(b.result.current.items).toHaveLength(1);
  });

  it('a refetch after a local write subscribes on a fresh channel, not the one being removed', async () => {
    h.state.rows = [userRow];
    const { result } = renderHook(() => useSupabaseCollectionLive('users', {}));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const [first] = [...h.state.channels.values()];

    act(() => emitSupabaseWrite('users'));

    await waitFor(() => expect(h.state.channels.size).toBe(2));
    expect(h.client.removeChannel).toHaveBeenCalledWith(first);
    expect(result.current.items).toHaveLength(1);
  });

  it('removes its own channel on unmount', async () => {
    const { result, unmount } = renderHook(() => useSupabaseCollectionLive('users', {}));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const [channel] = [...h.state.channels.values()];

    unmount();

    expect(h.client.removeChannel).toHaveBeenCalledTimes(1);
    expect(h.client.removeChannel).toHaveBeenCalledWith(channel);
  });

  it('a realtime failure costs live updates, never the page', async () => {
    h.state.rows = [userRow];
    h.state.failChannel = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result, unmount } = renderHook(() => useSupabaseCollectionLive('users', {}));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.items).toHaveLength(1);
    expect(result.current.error).toBeNull();
    expect(warn).toHaveBeenCalled();
    unmount(); // nothing to remove — must not throw either
    expect(h.client.removeChannel).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('useSupabaseDocLive — one realtime channel per subscription (#710)', () => {
  const configRow = { source_doc_id: 'org-1_fleet', org_id: 'org-1', data: { fleetName: 'F' } };

  it('two readers of the same document do not share a channel', async () => {
    h.state.rows = [configRow];
    const a = renderHook(() => useSupabaseDocLive('app_config', 'org-1_fleet'));
    const b = renderHook(() => useSupabaseDocLive('app_config', 'org-1_fleet'));

    await waitFor(() => expect(b.result.current.loading).toBe(false));
    expect(h.state.channels.size).toBe(2);
    expect(a.result.current.item).toMatchObject({ fleetName: 'F' });
    expect(b.result.current.item).toMatchObject({ fleetName: 'F' });
  });

  it('a realtime failure costs live updates, never the page', async () => {
    h.state.rows = [configRow];
    h.state.failChannel = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useSupabaseDocLive('app_config', 'org-1_fleet'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.item).toMatchObject({ fleetName: 'F' });
    expect(result.current.error).toBeNull();
    warn.mockRestore();
  });
});
