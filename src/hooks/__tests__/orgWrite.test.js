/**
 * orgWrite / orgUpdate / orgDelete — the ADR-0003 leak-proof WRITE layer.
 * These lock the invariants the whole multi-tenancy refactor (B1→B3) relies on:
 *   1. every create stamps orgId + createdByUid;
 *   2. createdAt/updatedAt default to a server timestamp BUT a caller may override
 *      them (CostContext keeps ISO strings — see B1 commit + docs/SCHEMA.md);
 *   3. NOTHING is ever written when there is no active org (fail loud).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ __ref: 'collection' })),
  doc: vi.fn((_db, col, id) => ({ __ref: 'doc', col, id })),
  addDoc: vi.fn(() => Promise.resolve({ id: 'generated-id' })),
  setDoc: vi.fn(() => Promise.resolve()),
  updateDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
  serverTimestamp: vi.fn(() => '__SERVER_TS__'),
}));

vi.mock('../../lib/firebase.js', () => ({
  db: { __db: true },
  auth: { currentUser: { uid: 'user-1' } },
}));

// Pass-through safeWrite: invoke the writer so the firestore mock is exercised.
vi.mock('../../utils/firestoreWrite.js', () => ({
  safeWrite: vi.fn(async (writer) => ({ ok: true, data: await writer() })),
}));

import { addDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { orgWrite, orgUpdate, orgDelete, setActiveOrg, getActiveOrg } from '../orgWrite.js';

beforeEach(() => {
  vi.clearAllMocks();
  setActiveOrg('org-A');
});

describe('orgWrite — leak-proof create', () => {
  it('stamps orgId + createdByUid + server timestamps by default', async () => {
    await orgWrite('costs', { name: 'Insurance', amount: 350 });
    expect(addDoc).toHaveBeenCalledTimes(1);
    const payload = addDoc.mock.calls[0][1];
    expect(payload).toMatchObject({
      name: 'Insurance',
      amount: 350,
      orgId: 'org-A',
      createdByUid: 'user-1',
      createdAt: '__SERVER_TS__',
      updatedAt: '__SERVER_TS__',
    });
  });

  it('preserves caller-provided createdAt/updatedAt (CostContext keeps ISO strings)', async () => {
    await orgWrite('costs', {
      name: 'x',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    const payload = addDoc.mock.calls[0][1];
    expect(payload.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(payload.updatedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(payload.orgId).toBe('org-A'); // org stamp is NOT overridable
  });

  it('upserts at an explicit id via setDoc (merge:false default)', async () => {
    await orgWrite('config', { fleetSize: 20 }, { id: 'org-A_fleet' });
    expect(setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload, opts] = setDoc.mock.calls[0];
    expect(ref.id).toBe('org-A_fleet');
    expect(payload).toMatchObject({ fleetSize: 20, orgId: 'org-A' });
    expect(opts).toEqual({ merge: false });
  });

  it('throws and never writes when there is no active org', async () => {
    setActiveOrg(null);
    await expect(orgWrite('costs', { name: 'x' })).rejects.toThrow(/no active orgId/);
    expect(addDoc).not.toHaveBeenCalled();
  });
});

describe('orgUpdate / orgDelete', () => {
  it('orgUpdate stamps a server updatedAt by default', async () => {
    await orgUpdate('costs', 'doc-1', { amount: 99 });
    const [, patch] = updateDoc.mock.calls[0];
    expect(patch).toEqual({ amount: 99, updatedAt: '__SERVER_TS__' });
  });

  it('orgUpdate preserves a caller-provided updatedAt', async () => {
    await orgUpdate('costs', 'doc-1', { amount: 99, updatedAt: '2026-03-03T00:00:00.000Z' });
    const [, patch] = updateDoc.mock.calls[0];
    expect(patch.updatedAt).toBe('2026-03-03T00:00:00.000Z');
  });

  it('orgUpdate throws and never writes when there is no active org', async () => {
    setActiveOrg(null);
    await expect(orgUpdate('costs', 'doc-1', { amount: 1 })).rejects.toThrow(/no active orgId/);
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('orgDelete deletes when an org is active and throws when not', async () => {
    await orgDelete('costs', 'doc-1');
    expect(deleteDoc).toHaveBeenCalledTimes(1);
    setActiveOrg(null);
    await expect(orgDelete('costs', 'doc-2')).rejects.toThrow(/no active orgId/);
  });
});

describe('setActiveOrg / getActiveOrg', () => {
  it('round-trips the active org and clears to null', () => {
    setActiveOrg('org-B');
    expect(getActiveOrg()).toBe('org-B');
    setActiveOrg(null);
    expect(getActiveOrg()).toBe(null);
  });
});
