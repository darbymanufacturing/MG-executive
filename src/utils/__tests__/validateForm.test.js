import { describe, test, expect } from 'vitest';
import { validate, firstError } from '../validateForm.js';
import { costSchema } from '../schemas/costSchema.js';
import { projectSchema } from '../schemas/projectSchema.js';
import { ticketSchema } from '../schemas/ticketSchema.js';
import { scooterSchema } from '../schemas/scooterSchema.js';
import { partSchema } from '../schemas/partSchema.js';

describe('validate — required', () => {
  test('flags missing required field', () => {
    const result = validate({}, { name: { required: true, type: 'string' } });
    expect(result.isValid).toBe(false);
    expect(result.errors.name).toMatch(/required/i);
  });

  test('flags empty string as missing', () => {
    const result = validate({ name: '' }, { name: { required: true, type: 'string' } });
    expect(result.isValid).toBe(false);
  });

  test('flags whitespace-only string as missing', () => {
    const result = validate({ name: '   ' }, { name: { required: true, type: 'string' } });
    expect(result.isValid).toBe(false);
  });

  test('flags empty array as missing for required array fields', () => {
    const result = validate({ tags: [] }, { tags: { required: true, type: 'array' } });
    expect(result.isValid).toBe(false);
  });

  test('allows missing optional fields', () => {
    const result = validate({}, { name: { type: 'string' } });
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual({});
  });
});

describe('validate — type checks', () => {
  test('string type rejects numbers', () => {
    const result = validate({ name: 42 }, { name: { type: 'string' } });
    expect(result.isValid).toBe(false);
  });

  test('number type accepts numeric strings', () => {
    // The validator coerces via Number() — numeric strings are accepted
    const result = validate({ amount: '42' }, { amount: { type: 'number' } });
    expect(result.isValid).toBe(true);
  });

  test('number type rejects non-numeric strings', () => {
    const result = validate({ amount: 'abc' }, { amount: { type: 'number' } });
    expect(result.isValid).toBe(false);
  });

  test('date type accepts ISO date strings', () => {
    const result = validate({ d: '2026-05-28' }, { d: { type: 'date' } });
    expect(result.isValid).toBe(true);
  });

  test('date type rejects garbage strings', () => {
    const result = validate({ d: 'tomorrow maybe' }, { d: { type: 'date' } });
    expect(result.isValid).toBe(false);
  });
});

describe('validate — length and range', () => {
  test('enforces maxLength', () => {
    expect(validate({ n: 'abc' }, { n: { type: 'string', maxLength: 5 } }).isValid).toBe(true);
    expect(validate({ n: 'abcdef' }, { n: { type: 'string', maxLength: 5 } }).isValid).toBe(false);
  });

  test('enforces minLength', () => {
    expect(validate({ n: 'ab' }, { n: { type: 'string', minLength: 3 } }).isValid).toBe(false);
    expect(validate({ n: 'abc' }, { n: { type: 'string', minLength: 3 } }).isValid).toBe(true);
  });

  test('enforces min/max numeric bounds', () => {
    const schema = { a: { type: 'number', min: 0, max: 100 } };
    expect(validate({ a: 50 }, schema).isValid).toBe(true);
    expect(validate({ a: -1 }, schema).isValid).toBe(false);
    expect(validate({ a: 101 }, schema).isValid).toBe(false);
    expect(validate({ a: 0 }, schema).isValid).toBe(true);     // boundary
    expect(validate({ a: 100 }, schema).isValid).toBe(true);   // boundary
  });
});

describe('validate — pattern + oneOf', () => {
  test('enforces pattern', () => {
    const schema = { code: { type: 'string', pattern: /^[A-Z]{3}$/ } };
    expect(validate({ code: 'ABC' }, schema).isValid).toBe(true);
    expect(validate({ code: 'abc' }, schema).isValid).toBe(false);
    expect(validate({ code: 'ABCD' }, schema).isValid).toBe(false);
  });

  test('enforces oneOf', () => {
    const schema = { status: { oneOf: ['active', 'archived'] } };
    expect(validate({ status: 'active' }, schema).isValid).toBe(true);
    expect(validate({ status: 'foo' }, schema).isValid).toBe(false);
  });
});

describe('validate — date relationships', () => {
  test('after rejects equal dates', () => {
    const schema = {
      start: { type: 'date' },
      end:   { type: 'date', after: 'start' },
    };
    expect(validate({ start: '2026-01-01', end: '2026-01-02' }, schema).isValid).toBe(true);
    expect(validate({ start: '2026-01-01', end: '2026-01-01' }, schema).isValid).toBe(false);
    expect(validate({ start: '2026-01-02', end: '2026-01-01' }, schema).isValid).toBe(false);
  });

  test('onOrAfter accepts equal dates', () => {
    const schema = {
      start: { type: 'date' },
      end:   { type: 'date', onOrAfter: 'start' },
    };
    expect(validate({ start: '2026-01-01', end: '2026-01-01' }, schema).isValid).toBe(true);
    expect(validate({ start: '2026-01-02', end: '2026-01-01' }, schema).isValid).toBe(false);
  });
});

describe('validate — custom', () => {
  test('runs custom rule, surfaces returned message', () => {
    const schema = {
      password: {
        type: 'string',
        custom: (v) => v.length < 8 ? 'Password too short' : null,
      },
    };
    expect(validate({ password: 'short' }, schema).errors.password).toBe('Password too short');
    expect(validate({ password: 'longenough' }, schema).isValid).toBe(true);
  });

  test('custom receives all values for cross-field checks', () => {
    const schema = {
      confirmPassword: {
        custom: (v, all) => v === all.password ? null : "Passwords don't match",
      },
    };
    expect(validate({ password: 'a', confirmPassword: 'a' }, schema).isValid).toBe(true);
    expect(validate({ password: 'a', confirmPassword: 'b' }, schema).errors.confirmPassword)
      .toMatch(/match/);
  });
});

describe('firstError helper', () => {
  test('returns first error string or null', () => {
    expect(firstError({})).toBeNull();
    expect(firstError({ a: 'oops', b: 'also bad' })).toBe('oops');
  });
});

// ── Per-form schema regression tests ───────────────────────────────────

describe('costSchema', () => {
  test('valid minimal cost passes', () => {
    const result = validate({
      name: 'Internet',
      amount: 50,
      category: 'tech',
      frequency: 'monthly',
      startDate: '2026-01-01',
    }, costSchema);
    expect(result.isValid).toBe(true);
  });

  test('rejects negative amount', () => {
    const result = validate({
      name: 'X', amount: -10, category: 'tech', frequency: 'monthly', startDate: '2026-01-01',
    }, costSchema);
    expect(result.isValid).toBe(false);
    expect(result.errors.amount).toBeDefined();
  });

  test('rejects invalid frequency', () => {
    const result = validate({
      name: 'X', amount: 10, category: 'tech', frequency: 'fortnightly', startDate: '2026-01-01',
    }, costSchema);
    expect(result.isValid).toBe(false);
    expect(result.errors.frequency).toBeDefined();
  });

  test('rejects endDate before startDate', () => {
    const result = validate({
      name: 'X', amount: 10, category: 'tech', frequency: 'one-time',
      startDate: '2026-06-01', endDate: '2026-01-01',
    }, costSchema);
    expect(result.isValid).toBe(false);
    expect(result.errors.endDate).toBeDefined();
  });
});

describe('projectSchema', () => {
  test('valid project passes', () => {
    expect(validate({
      name: 'Test', owner: 'Kostas', category: 'Expansion',
    }, projectSchema).isValid).toBe(true);
  });

  test('rejects target before start', () => {
    const result = validate({
      name: 'Test', owner: 'Kostas', category: 'Expansion',
      startDate: '2026-06-01', targetDate: '2026-01-01',
    }, projectSchema);
    expect(result.isValid).toBe(false);
  });
});

describe('ticketSchema, scooterSchema, partSchema — sanity', () => {
  test('ticketSchema requires scooterId, category, status, dateEntered', () => {
    expect(validate({}, ticketSchema).isValid).toBe(false);
    expect(validate({
      scooterId: 'S1', category: 'flat-tire', status: 'Open', dateEntered: '2026-05-01',
    }, ticketSchema).isValid).toBe(true);
  });

  test('scooterSchema requires id, model, city, status', () => {
    expect(validate({}, scooterSchema).isValid).toBe(false);
    expect(validate({
      scooterId: 'S1', model: 'Okai', city: 'Athens', status: 'Active',
    }, scooterSchema).isValid).toBe(true);
  });

  test('partSchema requires partName + stockOnHand ≥ 0', () => {
    expect(validate({}, partSchema).isValid).toBe(false);
    // #364 — field renamed from `name` to `partName` to match PartForm.jsx state
    expect(validate({ partName: 'Tire', stockOnHand: 0 }, partSchema).isValid).toBe(true);
    expect(validate({ partName: 'Tire', stockOnHand: -1 }, partSchema).isValid).toBe(false);
  });
});
