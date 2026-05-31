/**
 * Locks the B6 backfill collection-treatment contract. This is the safety net for the
 * single riskiest judgment in the irreversible migration: a deterministic-id collection
 * wrongly classified as STAMP would silently leave its ids un-prefixed → cross-org
 * collision once a 2nd org exists. These tests make that misclassification fail in CI.
 */
import { describe, it, expect } from 'vitest';
import { MIGRATE, STAMP, CONFIG_SINGLETONS, SPECIAL, classifyCollection, effectiveTreatment } from '../backfillPlan.js';

// The 20 org-scoped data collections per docs/SCHEMA.md (the universe the backfill must
// cover). users/organizations are handled specially; the config/pow PARENTS hold the
// migrated singletons. If SCHEMA gains a collection, this list + the plan must grow.
const SCHEMA_DATA_COLLECTIONS = [
  'costs', 'revenue', 'maintenanceTickets', 'maintenanceParts', 'scooters',
  'projects', 'decisionGates', 'brainstormIdeas', 'diary', 'telemetryEvents',
  'scooterTrips', 'sprEvents', 'sprWeather', 'issues', 'repairProcedures',
  'repairSessions', 'pow_tasks', 'notifications', 'briefs', 'syncLogs',
];

describe('backfill plan — MIGRATE vs STAMP partition', () => {
  it('never classifies a collection as BOTH migrate and stamp', () => {
    const overlap = MIGRATE.filter((c) => STAMP.includes(c));
    expect(overlap).toEqual([]);
  });

  it('covers every SCHEMA data collection exactly once (migrate XOR stamp)', () => {
    for (const c of SCHEMA_DATA_COLLECTIONS) {
      const inM = MIGRATE.includes(c);
      const inS = STAMP.includes(c);
      expect(inM || inS, `${c} is unclassified — backfill would SKIP it`).toBe(true);
      expect(inM && inS, `${c} is double-classified`).toBe(false);
    }
  });

  it('does not classify a SCHEMA data collection as special (would skip real data)', () => {
    for (const c of SCHEMA_DATA_COLLECTIONS) {
      expect(SPECIAL.includes(c), `${c} wrongly marked special`).toBe(false);
    }
  });

  it('MIGRATE = exactly the deterministic-id collections (the collision-prone set)', () => {
    // Locked explicitly: these are the ids built from business values (scooter code,
    // date, city, SKU) that are NOT unique across orgs. Changing this set is a
    // deliberate, reviewed act — the test must change with it.
    expect([...MIGRATE].sort()).toEqual([
      'maintenanceParts', 'maintenanceTickets', 'revenue', 'scooterTrips',
      'scooters', 'sprEvents', 'sprWeather', 'telemetryEvents',
    ]);
  });
});

describe('classifyCollection()', () => {
  it('returns the right treatment per bucket', () => {
    expect(classifyCollection('revenue')).toBe('migrate');
    expect(classifyCollection('telemetryEvents')).toBe('migrate');
    expect(classifyCollection('costs')).toBe('stamp');
    expect(classifyCollection('repairSessions')).toBe('stamp');
    expect(classifyCollection('users')).toBe('special');
    expect(classifyCollection('organizations')).toBe('special');
  });

  it('flags an unrecognized collection as unknown (script must log + skip, never touch)', () => {
    expect(classifyCollection('some_new_collection')).toBe('unknown');
    expect(classifyCollection('bank_transactions')).toBe('unknown'); // not in plan → must be reviewed before cutover
  });
});

describe('effectiveTreatment() — --stamp-only deferral', () => {
  it('normally returns the base classification (no flag = no change)', () => {
    expect(effectiveTreatment('telemetryEvents')).toBe('migrate');
    expect(effectiveTreatment('costs')).toBe('stamp');
    expect(effectiveTreatment('users')).toBe('special');
  });

  it('stampOnly downgrades a migrate collection to stamp (field-only, defer id-prefix)', () => {
    expect(effectiveTreatment('telemetryEvents', { stampOnly: true })).toBe('stamp');
    expect(effectiveTreatment('revenue', { stampOnly: true })).toBe('stamp');
  });

  it('stampOnly does NOT change stamp/special/unknown', () => {
    expect(effectiveTreatment('costs', { stampOnly: true })).toBe('stamp');
    expect(effectiveTreatment('users', { stampOnly: true })).toBe('special');
    expect(effectiveTreatment('whatever_new', { stampOnly: true })).toBe('unknown');
  });
});

describe('config singletons', () => {
  it('covers the 5 known singleton config docs', () => {
    const ids = CONFIG_SINGLETONS.map(([c, id]) => `${c}/${id}`).sort();
    expect(ids).toEqual([
      'config/fleet', 'config/maintenance', 'config/scooters', 'config/spr', 'pow/config',
    ]);
  });
});
