/**
 * api/__tests__/csv-import.test.js — "send the export to Omni" (AUTOMATION_PLAN §4.5).
 * A Hopp export forwarded on WhatsApp/email must import exactly like the in-app
 * importer: same parser, the owner's remembered VAT answer, the right city and
 * fleet, the same document ids — and re-sending a file must not double anything.
 *
 * Run with:  npx vitest run api/__tests__/csv-import.test.js
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeSupabase, row } from './helpers/fakeSupabase.js';

let fake;
const firestoreWrites = [];
vi.mock('../_lib/supabase-admin.js', () => ({ supabaseAdmin: () => fake }));
vi.mock('../_lib/firebase-admin.js', () => ({
  getDb: () => ({
    collection: (name) => ({ doc: (id) => ({ path: `${name}/${id}` }) }),
    batch: () => {
      const ops = [];
      return {
        set: (ref, data) => ops.push({ path: ref.path, data }),
        commit: async () => { firestoreWrites.push(...ops); },
      };
    },
  }),
}));

const { detectCsvKind, importRevenueCsvServer, importRepairLogServer } = await import('../_lib/csv-import.js');

const ORG = 'org1';
const HEADERS = [
  'Date', 'VAT rate', 'Currency', 'Total trips', 'Free trips', 'Penalty trips',
  'Total ride trip minutes', 'Total paused trip minutes', 'Total trip distance (km)',
  'Unique users count', 'Unique vehicles count', 'Total raw income',
  'Total free trip worth', 'Total raw refunds', 'Total vat', 'Refunded vat',
  'Unpaid user revenue', 'User debt refunds', 'Unpaid org revenue', 'Org debt refunds',
  'Total paid debt', 'Average payment', 'Average worth', 'Total paid revenue',
  'Total paid refunds',
];
const revenueLine = (date, paid) => HEADERS.map((h) => {
  if (h === 'Date') return date;
  if (h === 'Currency') return 'EUR';
  if (h === 'VAT rate') return '24';
  if (h === 'Total paid revenue') return String(paid);
  return '1';
}).join(',');
// Hopp writes dates as "20 Sep 2026" — the real export format, not ISO.
const REVENUE_CSV = [HEADERS.join(','), revenueLine('20 Sep 2026', 124), revenueLine('21 Sep 2026', 248)].join('\n');

const REPAIRS_CSV = [
  'Scooter ID,Issue type,Issue tags,Real issue,Comment,Parts used,Created,Fixed,Fixed by',
  '41735,Brakes,brake,Cable,squeak,brake cable,2026-09-10,2026-09-11,Nikos',
  '51946,Light,light,Bulb,dark,,2026-09-12,,',
].join('\n');

beforeEach(() => {
  firestoreWrites.length = 0;
  fake = fakeSupabase({
    app_config: [row(ORG, `${ORG}_fleet`, {
      locations: ['Corinth', 'Nafplion'],
      financial: { vatRate: 0.24 },
      revenueImport: { amountsIncludeVat: true, location: 'Corinth' },
    })],
    fleets: [row(ORG, 'fleet_corinth', { name: 'Corinth fleet', cities: ['Corinth'] })],
    revenue_days: [],
    maintenance_tickets: [],
  });
});

describe('detectCsvKind', () => {
  it('tells a trip-analytics export from a repair log, and refuses anything else', () => {
    expect(detectCsvKind(REVENUE_CSV)).toBe('revenue');
    expect(detectCsvKind(`${String.fromCharCode(0xfeff)}${REVENUE_CSV}`)).toBe('revenue'); // Windows BOM
    expect(detectCsvKind(REPAIRS_CSV)).toBe('repairs');
    expect(detectCsvKind('a,b,c\n1,2,3')).toBeNull();
  });
});

describe('importRevenueCsvServer', () => {
  it("imports with the owner's remembered VAT answer, city and fleet, at the app's ids", async () => {
    const r = await importRevenueCsvServer({ orgId: ORG, csvText: REVENUE_CSV, by: 'whatsapp:Kostas' });
    expect(r).toMatchObject({ days: 2, from: '2026-09-20', to: '2026-09-21', location: 'Corinth', amountsIncludeVat: true });

    const rows = fake.tables.revenue_days;
    expect(rows.map((x) => x.source_doc_id).sort()).toEqual([`${ORG}_2026-09-20_Corinth`, `${ORG}_2026-09-21_Corinth`]);
    const first = rows.find((x) => x.source_doc_id.endsWith('2026-09-20_Corinth'));
    expect(first.data).toMatchObject({ totalPaidRevenue: 100, location: 'Corinth', fleetId: 'fleet_corinth', orgId: ORG });
    expect(first).toMatchObject({ revenue_date: '2026-09-20', total_paid_revenue: 100 });
    // Firestore stays authoritative for revenue (#481), exactly like the app.
    expect(firestoreWrites.map((w) => w.path)).toContain(`revenue/${ORG}_2026-09-20_Corinth`);
  });

  it('a city in the caption wins; sending the same file twice changes nothing', async () => {
    await importRevenueCsvServer({ orgId: ORG, csvText: REVENUE_CSV, caption: 'Nafplion September' });
    await importRevenueCsvServer({ orgId: ORG, csvText: REVENUE_CSV, caption: 'Nafplion September' });
    expect(fake.tables.revenue_days.map((x) => x.source_doc_id).sort()).toEqual([`${ORG}_2026-09-20_Nafplion`, `${ORG}_2026-09-21_Nafplion`]);
  });

  it('reports a file it cannot read instead of importing nothing silently', async () => {
    const r = await importRevenueCsvServer({ orgId: ORG, csvText: 'Date\n' });
    expect(r.days).toBe(0);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe('importRepairLogServer', () => {
  it('imports each repair once — a re-sent file or one already imported in the app is skipped', async () => {
    fake.tables.maintenance_tickets.push(row(ORG, `${ORG}_41735_2026-09-10`, { scooterId: '41735', dateEntered: '2026-09-10', issueDescription: 'Brakes' }));
    const first = await importRepairLogServer({ orgId: ORG, csvText: REPAIRS_CSV });
    const again = await importRepairLogServer({ orgId: ORG, csvText: REPAIRS_CSV });
    expect(first.tickets + first.skipped).toBe(2);
    expect(again.tickets).toBe(0);
    expect(fake.tables.maintenance_tickets).toHaveLength(1 + first.tickets);
    expect(fake.tables.maintenance_tickets.every((r) => r.source_doc_id.startsWith(`${ORG}_`))).toBe(true);
  });
});
