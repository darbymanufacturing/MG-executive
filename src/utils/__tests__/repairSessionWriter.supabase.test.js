/**
 * repairSessionWriter — Supabase-path (ADR-0015 S5) coverage.
 * When layerFor('maintenanceTickets') === 'supabase', completeRepairSession routes
 * the whole atomic completion to the complete_repair_session RPC instead of a
 * Firestore runTransaction. Kept in a SEPARATE file so the Supabase mocks don't
 * disturb the Firestore-path regression suite (repairSessionWriter.test.js).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockRpc = vi.fn();
vi.mock('../../lib/supabase.js', () => ({ supabase: { rpc: (...a) => mockRpc(...a) } }));
vi.mock('../../lib/dataLayerConfig.js', () => ({ layerFor: vi.fn(() => 'supabase') }));
vi.mock('../../hooks/orgWrite.js', () => ({ getActiveOrg: vi.fn(() => 'org1') }));
// Firestore + db are imported at module load but never CALLED on the Supabase path.
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(), increment: vi.fn(), arrayUnion: vi.fn(), serverTimestamp: vi.fn(), runTransaction: vi.fn(),
}));
vi.mock('../../lib/firebase.js', () => ({ db: {} }));

import { completeRepairSession } from '../repairSessionWriter.js';
import { getActiveOrg } from '../../hooks/orgWrite.js';

const ARGS = {
  ticketDocId: 'org1_sc42_2026-06-01', sessionId: 'sess-1', procedureId: 'proc-1',
  scooterId: 'sc42', technicianUid: 'u1', technicianName: 'Alice',
  startedAt: new Date('2026-06-01T10:00:00.000Z'), completedAt: new Date('2026-06-01T10:30:00.000Z'),
  steps: [{ stepNumber: 1, partsUsed: [{ partId: 'p1', partName: 'Brake', quantity: 2, unitCost: 5 }], notes: 'n', photoUrls: [] }],
  estimatedMinutes: 60, labourRatePerHour: 25, extraMinutes: 0, extraWorkNote: '',
  signatureUrl: 'http://sig', signedByName: 'Alice',
};

beforeEach(() => {
  vi.clearAllMocks();
  getActiveOrg.mockReturnValue('org1');
  mockRpc.mockResolvedValue({ data: { ok: true, totalCost: 35 }, error: null });
});

describe('completeRepairSession — Supabase path (ADR-0015)', () => {
  it('calls complete_repair_session with the aggregated, ISO-stringified payload', async () => {
    await completeRepairSession(ARGS);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [name, params] = mockRpc.mock.calls[0];
    expect(name).toBe('complete_repair_session');
    const p = params.p_payload;
    expect(p.ticketDocId).toBe('org1_sc42_2026-06-01');
    expect(p.sessionId).toBe('sess-1');
    expect(p.scooterId).toBe('sc42');
    expect(p.startedAt).toBe('2026-06-01T10:00:00.000Z');   // Date → ISO
    expect(p.completedAt).toBe('2026-06-01T10:30:00.000Z');
    expect(p.labourMinutes).toBe(30);                        // (end - start) / 60000
    expect(p.estimatedMinutes).toBe(60);
    expect(p.labourRatePerHour).toBe(25);
    expect(p.signatureUrl).toBe('http://sig');
    // parts aggregated across steps, passed for the RPC's live-unitCost fixup
    expect(p.aggregatedPartsUsed).toEqual([{ partId: 'p1', partName: 'Brake', quantity: 2, unitCost: 5 }]);
  });

  it('re-throws the RPC error (keeps the throw contract the UI catches)', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'Insufficient stock for Brake: have 1, need 2' } });
    await expect(completeRepairSession(ARGS)).rejects.toThrow(/Insufficient stock/);
  });

  it('throws on no active org (ADR-0003) before ever calling the RPC', async () => {
    getActiveOrg.mockReturnValueOnce(null);
    await expect(completeRepairSession(ARGS)).rejects.toThrow(/no active orgId/);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
