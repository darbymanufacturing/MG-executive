import { describe, it, expect } from 'vitest';
import { orgDocId } from '../orgDocId.js';

describe('orgDocId', () => {
  it('prefixes a single part with the org', () => {
    expect(orgDocId('acme', '70055')).toBe('acme_70055');
  });

  it('joins multiple parts with underscores after the org prefix', () => {
    expect(orgDocId('acme', '2026-01-01', 'Corinth')).toBe('acme_2026-01-01_Corinth');
  });

  it('sanitizes Firestore-forbidden characters in the tail', () => {
    // forbidden: / . # $ [ ]
    expect(orgDocId('acme', 'a/b.c#d$e[f]g')).toBe('acme_a_b_c_d_e_f_g');
  });

  it('coerces null/undefined parts to empty strings (no "null" literal)', () => {
    expect(orgDocId('acme', 'x', null, undefined)).toBe('acme_x__');
  });

  it('is idempotent for the backfill invariant: orgDocId(org, oldId) === `${org}_${oldId}` for clean ids', () => {
    const oldId = '70055_2026-01-01';
    expect(orgDocId('acme', oldId)).toBe(`acme_${oldId}`);
  });

  it('throws without an orgId (deterministic ids must never be unscoped)', () => {
    expect(() => orgDocId(null, '70055')).toThrow(/orgId is required/);
    expect(() => orgDocId('', '70055')).toThrow(/orgId is required/);
  });
});
