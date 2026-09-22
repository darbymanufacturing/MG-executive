/**
 * api/__tests__/require-auth.orgScope.test.js
 *
 * The org claim plumbing behind the Autopilot endpoints (2026-09-23):
 *   - requireUser / requireCronOrUser carry the caller's `orgId` custom claim
 *     (stamped by sync-claim, ADR-0004) so user-triggered endpoints scope to the
 *     CALLER's org instead of a configured default
 *   - requireOrgMember lets a cron run a configured org's job, but refuses a
 *     manual trigger from any other tenant (or from a session with no org claim)
 *
 * Run with:  npx vitest run api/__tests__/require-auth.orgScope.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyIdToken = vi.fn();
vi.mock('../_lib/firebase-admin.js', () => ({ verifyIdToken: (...a) => verifyIdToken(...a) }));

const { requireUser, requireCronOrUser, requireOrgMember } = await import('../_lib/require-auth.js');

const res = () => {
  const r = { statusCode: null, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const req = (token, headers = {}) => ({ headers: { authorization: `Bearer ${token}`, ...headers } });

beforeEach(() => {
  verifyIdToken.mockReset();
  process.env.CRON_SECRET = 'cron-secret-value';
});

describe('requireUser — org claim', () => {
  it("returns the caller's orgId claim", async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1', email: 'a@b.c', orgId: 'org1', user_role: 'owner' });
    const user = await requireUser(req('tok'), res(), { roles: ['owner'] });
    expect(user).toEqual({ uid: 'u1', email: 'a@b.c', role: 'owner', orgId: 'org1' });
  });

  it('returns orgId null when the claim was never synced', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1' });
    const user = await requireUser(req('tok'), res());
    expect(user.orgId).toBeNull();
  });
});

describe('requireCronOrUser — org claim', () => {
  it('a manual trigger carries the orgId claim', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1', orgId: 'org1', user_role: 'admin' });
    const auth = await requireCronOrUser(req('user-token'), res());
    expect(auth).toMatchObject({ trigger: 'manual', uid: 'u1', role: 'admin', orgId: 'org1' });
  });

  it('a cron trigger has no user org', async () => {
    const auth = await requireCronOrUser(req('cron-secret-value', { 'x-vercel-cron': '1' }), res());
    expect(auth).toMatchObject({ trigger: 'cron', uid: null });
    expect(verifyIdToken).not.toHaveBeenCalled();
  });
});

describe('requireOrgMember', () => {
  it('lets the cron run the configured org job', () => {
    const r = res();
    expect(requireOrgMember({ trigger: 'cron' }, 'org1', r)).toBe(true);
    expect(r.statusCode).toBeNull();
  });

  it('lets a member of that org trigger it manually', () => {
    const r = res();
    expect(requireOrgMember({ trigger: 'manual', orgId: 'org1' }, 'org1', r)).toBe(true);
    expect(r.statusCode).toBeNull();
  });

  it("refuses another tenant's admin with 403", () => {
    const r = res();
    expect(requireOrgMember({ trigger: 'manual', orgId: 'org2' }, 'org1', r)).toBe(false);
    expect(r.statusCode).toBe(403);
  });

  it('refuses a manual trigger with no org claim', () => {
    const r = res();
    expect(requireOrgMember({ trigger: 'manual', orgId: null }, 'org1', r)).toBe(false);
    expect(r.statusCode).toBe(403);
  });
});
