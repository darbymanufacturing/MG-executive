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
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs,
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
    await assertSucceeds(setDoc(doc(db, 'costs', 'orgA_new'), { orgId: 'orgA', amount: 5 }));
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
    await assertSucceeds(setDoc(doc(db, 'maintenanceTickets', 'orgA_crewtix'), { orgId: 'orgA', status: 'Active' }));
  });

  it('crew can READ org data (e.g. costs)', async () => {
    const db = ctx('uC', 'orgA', 'crew').firestore();
    await assertSucceeds(getDoc(doc(db, 'costs', 'orgA_cost1')));
  });

  it('staff (manager tier) can write costs', async () => {
    const db = ctx('uS', 'orgA', 'staff').firestore();
    await assertSucceeds(setDoc(doc(db, 'costs', 'orgA_staffcost'), { orgId: 'orgA', amount: 7 }));
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

describe('default deny', () => {
  it('an unknown collection is closed even to an authed user', async () => {
    const db = ctx('uA', 'orgA', 'admin').firestore();
    await assertFails(getDoc(doc(db, 'someRandomCollection', 'x')));
    await assertFails(setDoc(doc(db, 'someRandomCollection', 'x'), { orgId: 'orgA' }));
  });
});
