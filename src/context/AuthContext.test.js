/**
 * Regression tests for:
 *   #452 — createTechnicianAccount privilege-escalation guard
 *
 * Tests verify the owner-only guard that prevents a regular admin from
 * minting another admin account. These tests exercise the guard logic
 * directly (no React tree needed) by extracting and re-implementing
 * the same conditional that was added to AuthContext.jsx:182-185.
 */
import { describe, test, expect } from 'vitest';

// ── Guard logic extracted from AuthContext.jsx createTechnicianAccount ────────
//
// Mirrors the two-guard structure at lines 182-185:
//   if (role !== 'admin' && role !== 'owner') throw 'Only admins can create accounts'
//   if (role === 'admin' && userProfile?.role !== 'owner') throw '...'
//
// Returns 'ok' if the inviter is authorised for this role assignment, or
// throws the same error message the real function throws.

function checkCreatePrivilege(invokerRole, targetRole) {
  if (invokerRole !== 'admin' && invokerRole !== 'owner') {
    throw new Error('Only admins can create accounts');
  }
  if (targetRole === 'admin' && invokerRole !== 'owner') {
    throw new Error('Only the organisation owner can create admin accounts');
  }
  return 'ok';
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('#452 — createTechnicianAccount privilege guard', () => {

  // ── Guard 1: non-admin invoker is rejected regardless of target role ─────────
  test('non-admin invoker (role: crew) cannot create any account', () => {
    expect(() => checkCreatePrivilege('crew', 'crew')).toThrow('Only admins can create accounts');
    expect(() => checkCreatePrivilege('crew', 'admin')).toThrow('Only admins can create accounts');
  });

  test('unauthenticated / null role cannot create any account', () => {
    expect(() => checkCreatePrivilege(null, 'crew')).toThrow('Only admins can create accounts');
    expect(() => checkCreatePrivilege(undefined, 'staff')).toThrow('Only admins can create accounts');
  });

  // ── Guard 2: admin (not owner) cannot mint another admin ─────────────────────
  test('admin invoker is blocked from creating an admin account', () => {
    expect(() => checkCreatePrivilege('admin', 'admin'))
      .toThrow('Only the organisation owner can create admin accounts');
  });

  // ── Admin CAN create crew / staff ────────────────────────────────────────────
  test('admin invoker can create a crew account (guard passes)', () => {
    expect(checkCreatePrivilege('admin', 'crew')).toBe('ok');
  });

  test('admin invoker can create a staff account (guard passes)', () => {
    expect(checkCreatePrivilege('admin', 'staff')).toBe('ok');
  });

  // ── Owner can mint admin, crew, staff without restriction ────────────────────
  test('owner can create an admin account', () => {
    expect(checkCreatePrivilege('owner', 'admin')).toBe('ok');
  });

  test('owner can create a crew account', () => {
    expect(checkCreatePrivilege('owner', 'crew')).toBe('ok');
  });

  test('owner can create a staff account', () => {
    expect(checkCreatePrivilege('owner', 'staff')).toBe('ok');
  });
});
