/**
 * Firestore security-rules tests (B4) — the SERVER-SIDE org-isolation proof.
 *
 * Runs against the Firestore emulator via `npm run test:rules`
 * (firebase emulators:exec --only firestore "vitest run --config vitest.rules.config.js").
 * Unlike the client-side hook unit tests (which prove the QUERY is constructed with a
 * where('orgId','==') clause), these prove the RULES actually BLOCK cross-org access —
 * the real tenant boundary.
 *
 * Auth model (ADR-0004): orgId + role live in custom claims on the token. We mint test
 * tokens with those claims directly, mirroring what api/sync-claim.js does in prod.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, collection, getDocs,
} from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = 'mg-executive-rules-test';

let testEnv;

// Authed contexts: (uid, { orgId, role }) — the claims the rules read.
const ctx = (uid, orgId, role) => testEnv.authenticatedContext(uid, { orgId, role });

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seed one doc per org WITHOUT rules (admin context), so reads have something to hit.
  await testEnv.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'costs', 'orgA_cost1'), { orgId: 'orgA', amount: 100, name: 'A cost' });
    await setDoc(doc(db, 'costs', 'orgB_cost1'), { orgId: 'orgB', amount: 200, name: 'B cost' });
    await setDoc(doc(db, 'maintenanceTickets', 'orgA_t1'), { orgId: 'orgA', status: 'Active' });
    await setDoc(doc(db, 'config', 'orgA_fleet'), { orgId: 'orgA', fleetSize: 20 });
    await setDoc(doc(db, 'users', 'userA'), { orgId: 'orgA', role: 'owner', email: 'a@a.com' });
    await setDoc(doc(db, 'users', 'userB'), { orgId: 'orgB', role: 'owner', email: 'b@b.com' });
    await setDoc(doc(db, 'organizations', 'orgA'), { ownerUid: 'ownerA-uid', name: 'Org A' });
  });
});

describe('org isolation — reads', () => {
  it('a manager reads their OWN org costs', async () => {
    const db = ctx('uA', 'orgA', 'admin').firestore();
    await assertSucceeds(getDoc(doc(db, 'costs', 'orgA_cost1')));
  });

  it("a manager CANNOT read another org's cost doc", async () => {
    const db = ctx('uA', 'orgA', 'admin').firestore();
    await assertFails(getDoc(doc(db, 'costs', 'orgB_cost1')));
  });

  it("a collection query scoped to another org's orgId fails the rules", async () => {
    // Even a where('orgId','==','orgB') query from an orgA user must be denied.
    const db = ctx('uA', 'orgA', 'admin').firestore();
    const { query, where } = await import('firebase/firestore');
    await assertFails(getDocs(query(collection(db, 'costs'), where('orgId', '==', 'orgB'))));
  });

  it('an unauthenticated user cannot read any doc', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'costs', 'orgA_cost1')));
  });
});

describe('org isolation — writes', () => {
  it('a manager creates a cost in their own org', async () => {
    const db = ctx('uA', 'orgA', 'admin').firestore();
    // Full valid shape required since #337 shape validation was added.
    await assertSucceeds(setDoc(doc(db, 'costs', 'orgA_new'), { orgId: 'orgA', name: 'fuel', amount: 5, category: 'fuel' }));
  });

  it("a manager CANNOT create a doc stamped with another org's id", async () => {
    const db = ctx('uA', 'orgA', 'admin').firestore();
    await assertFails(setDoc(doc(db, 'costs', 'sneaky'), { orgId: 'orgB', amount: 5 }));
  });

  it("a manager CANNOT update another org's existing doc", async () => {
    const db = ctx('uA', 'orgA', 'admin').firestore();
    await assertFails(updateDoc(doc(db, 'costs', 'orgB_cost1'), { amount: 999 }));
  });
});

describe('role gating within an org', () => {
  it('crew CANNOT create a cost (managers only)', async () => {
    const db = ctx('uC', 'orgA', 'crew').firestore();
    await assertFails(setDoc(doc(db, 'costs', 'orgA_crewcost'), { orgId: 'orgA', amount: 5 }));
  });

  it('crew CAN create a ticket in their own org', async () => {
    const db = ctx('uC', 'orgA', 'crew').firestore();
    // Full valid shape required since #337 shape validation was added.
    await assertSucceeds(setDoc(doc(db, 'maintenanceTickets', 'orgA_crewtix'), { orgId: 'orgA', scooterId: '001', status: 'Active' }));
  });

  it('crew can READ org data (e.g. costs)', async () => {
    const db = ctx('uC', 'orgA', 'crew').firestore();
    await assertSucceeds(getDoc(doc(db, 'costs', 'orgA_cost1')));
  });

  it('staff (manager tier) can write costs', async () => {
    const db = ctx('uS', 'orgA', 'staff').firestore();
    // Full valid shape required since #337 shape validation was added.
    await assertSucceeds(setDoc(doc(db, 'costs', 'orgA_staffcost'), { orgId: 'orgA', name: 'parts', amount: 7, category: 'parts' }));
  });
});

describe('config singleton + users + organizations', () => {
  it('a member reads their org config; another org cannot', async () => {
    await assertSucceeds(getDoc(doc(ctx('uA', 'orgA', 'staff').firestore(), 'config', 'orgA_fleet')));
    await assertFails(getDoc(doc(ctx('uB', 'orgB', 'admin').firestore(), 'config', 'orgA_fleet')));
  });

  it('a user reads their own profile but not a cross-org member profile', async () => {
    await assertSucceeds(getDoc(doc(ctx('userA', 'orgA', 'owner').firestore(), 'users', 'userA')));
    // orgB owner cannot read orgA's user
    await assertFails(getDoc(doc(ctx('userB', 'orgB', 'owner').firestore(), 'users', 'userA')));
  });

  it('an org owner reads their organization doc; outsiders cannot', async () => {
    await assertSucceeds(getDoc(doc(ctx('uA', 'orgA', 'owner').firestore(), 'organizations', 'orgA')));
    await assertFails(getDoc(doc(ctx('uB', 'orgB', 'owner').firestore(), 'organizations', 'orgA')));
  });
});

// Phase 2.5 F5 — contractor is crew-tier: org-isolated, may write tickets/repairSessions
// but NOT business data; cannot touch another org.
describe('F5 — contractor role (crew-tier)', () => {
  it('contractor CAN create a ticket in their own org', async () => {
    const db = ctx('uK', 'orgA', 'contractor').firestore();
    // Full valid shape required since #337 shape validation was added.
    await assertSucceeds(setDoc(doc(db, 'maintenanceTickets', 'orgA_ktix'), { orgId: 'orgA', scooterId: '70055', status: 'Active' }));
  });

  it('contractor CAN create a repair session in their own org', async () => {
    const db = ctx('uK', 'orgA', 'contractor').firestore();
    // Full valid shape required since #337 shape validation was added.
    await assertSucceeds(setDoc(doc(db, 'repairSessions', 'orgA_ksession'), { orgId: 'orgA', ticketId: 'tix-x', scooterId: '70055' }));
  });

  it('contractor CANNOT create a cost (managers only)', async () => {
    const db = ctx('uK', 'orgA', 'contractor').firestore();
    await assertFails(setDoc(doc(db, 'costs', 'orgA_kcost'), { orgId: 'orgA', amount: 5 }));
  });

  it('contractor can READ their own org data but NOT another org', async () => {
    await assertSucceeds(getDoc(doc(ctx('uK', 'orgA', 'contractor').firestore(), 'costs', 'orgA_cost1')));
    await assertFails(getDoc(doc(ctx('uK', 'orgA', 'contractor').firestore(), 'costs', 'orgB_cost1')));
  });

  it('contractor CANNOT write a ticket into another org', async () => {
    const db = ctx('uK', 'orgA', 'contractor').firestore();
    await assertFails(setDoc(doc(db, 'maintenanceTickets', 'sneaky'), { orgId: 'orgB', status: 'Active' }));
  });
});

// Phase 2.5 F6 — invites: same-org owner/admin may READ; ALL client writes denied
// (issue/redeem go through the Admin-SDK endpoints, which bypass rules).
describe('F6 — invites collection', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'invites', 'tok_A'), {
        orgId: 'orgA', email: 'x@y.com', role: 'contractor', status: 'pending',
      });
    });
  });

  it('an org admin reads their own org invite', async () => {
    await assertSucceeds(getDoc(doc(ctx('uA', 'orgA', 'admin').firestore(), 'invites', 'tok_A')));
  });

  it("another org's admin CANNOT read the invite", async () => {
    await assertFails(getDoc(doc(ctx('uB', 'orgB', 'admin').firestore(), 'invites', 'tok_A')));
  });

  it('crew/contractor CANNOT read invites (managers only)', async () => {
    await assertFails(getDoc(doc(ctx('uK', 'orgA', 'contractor').firestore(), 'invites', 'tok_A')));
  });

  it('NO client may create or update an invite (server-only)', async () => {
    const db = ctx('uA', 'orgA', 'admin').firestore();
    await assertFails(setDoc(doc(db, 'invites', 'tok_new'), { orgId: 'orgA', email: 'z@z.com', role: 'contractor', status: 'pending' }));
    await assertFails(updateDoc(doc(db, 'invites', 'tok_A'), { status: 'accepted' }));
  });
});

describe('default deny', () => {
  it('an unknown collection is closed even to an authed user', async () => {
    const db = ctx('uA', 'orgA', 'admin').firestore();
    await assertFails(getDoc(doc(db, 'someRandomCollection', 'x')));
    await assertFails(setDoc(doc(db, 'someRandomCollection', 'x'), { orgId: 'orgA' }));
  });
});

// #337 — shape validation: bogus / missing required fields must be rejected on create
describe('#337 — per-collection shape validation', () => {
  // writingOwnOrg() now requires orgId IS a string
  it('costs: rejected when orgId is not a string (boolean)', async () => {
    const db = ctx('uA', 'orgA', 'admin').firestore();
    await assertFails(setDoc(doc(db, 'costs', 'bogus1'), { orgId: true, name: 'x', amount: 5, category: 'fuel' }));
  });

  it('costs: rejected when required fields missing (no amount)', async () => {
    const db = ctx('uA', 'orgA', 'admin').firestore();
    await assertFails(setDoc(doc(db, 'costs', 'bogus2'), { orgId: 'orgA', name: 'x', category: 'fuel' }));
  });

  it('costs: rejected when amount is a string, not a number', async () => {
    const db = ctx('uA', 'orgA', 'admin').firestore();
    await assertFails(setDoc(doc(db, 'costs', 'bogus3'), { orgId: 'orgA', name: 'x', amount: 'five', category: 'fuel' }));
  });

  it('costs: accepted with all required fields correctly typed', async () => {
    const db = ctx('uA', 'orgA', 'admin').firestore();
    await assertSucceeds(setDoc(doc(db, 'costs', 'good1'), { orgId: 'orgA', name: 'fuel', amount: 50, category: 'fuel' }));
  });

  it('revenue: rejected when date field is missing', async () => {
    const db = ctx('uA', 'orgA', 'admin').firestore();
    await assertFails(setDoc(doc(db, 'revenue', 'bogus4'), { orgId: 'orgA', totalPaidRevenue: 100 }));
  });

  it('revenue: accepted with orgId + date', async () => {
    const db = ctx('uA', 'orgA', 'admin').firestore();
    await assertSucceeds(setDoc(doc(db, 'revenue', 'good2'), { orgId: 'orgA', date: '2026-06-01', totalPaidRevenue: 200 }));
  });

  it('maintenanceTickets: rejected when scooterId is missing', async () => {
    const db = ctx('uA', 'orgA', 'admin').firestore();
    await assertFails(setDoc(doc(db, 'maintenanceTickets', 'bogus5'), { orgId: 'orgA', status: 'Open' }));
  });

  it('maintenanceTickets (crew): rejected when status is missing', async () => {
    const db = ctx('uC', 'orgA', 'crew').firestore();
    await assertFails(setDoc(doc(db, 'maintenanceTickets', 'bogus6'), { orgId: 'orgA', scooterId: '001' }));
  });

  it('maintenanceTickets (crew): accepted with all required fields', async () => {
    const db = ctx('uC', 'orgA', 'crew').firestore();
    await assertSucceeds(setDoc(doc(db, 'maintenanceTickets', 'good3'), { orgId: 'orgA', scooterId: '001', status: 'Open' }));
  });

  it('repairSessions: rejected when ticketId is missing', async () => {
    const db = ctx('uA', 'orgA', 'admin').firestore();
    await assertFails(setDoc(doc(db, 'repairSessions', 'bogus7'), { orgId: 'orgA', scooterId: '001' }));
  });

  it('repairSessions (crew): accepted with ticketId + scooterId', async () => {
    const db = ctx('uC', 'orgA', 'crew').firestore();
    await assertSucceeds(setDoc(doc(db, 'repairSessions', 'good4'), { orgId: 'orgA', ticketId: 'tix1', scooterId: '001' }));
  });

  it('scooters: rejected when model is missing', async () => {
    const db = ctx('uA', 'orgA', 'admin').firestore();
    await assertFails(setDoc(doc(db, 'scooters', 'bogus8'), { orgId: 'orgA', city: 'Athens' }));
  });

  it('scooters: accepted with orgId + model', async () => {
    const db = ctx('uA', 'orgA', 'admin').firestore();
    await assertSucceeds(setDoc(doc(db, 'scooters', 'good5'), { orgId: 'orgA', model: 'Segway E2' }));
  });

  it('projects: rejected when name is missing', async () => {
    const db = ctx('uA', 'orgA', 'admin').firestore();
    await assertFails(setDoc(doc(db, 'projects', 'bogus9'), { orgId: 'orgA', description: 'no name' }));
  });

  it('projects: accepted with orgId + name', async () => {
    const db = ctx('uA', 'orgA', 'admin').firestore();
    await assertSucceeds(setDoc(doc(db, 'projects', 'good6'), { orgId: 'orgA', name: 'Fleet expansion' }));
  });

  it('issues: rejected when neither title nor description is present', async () => {
    const db = ctx('uA', 'orgA', 'admin').firestore();
    await assertFails(setDoc(doc(db, 'issues', 'bogus10'), { orgId: 'orgA', severity: 'high' }));
  });

  it('issues: accepted with orgId + title', async () => {
    const db = ctx('uA', 'orgA', 'admin').firestore();
    await assertSucceeds(setDoc(doc(db, 'issues', 'good7'), { orgId: 'orgA', title: 'Scooter stuck' }));
  });
});
