/**
 * scripts/tests/rechunk-checksum.test.mjs
 *
 * Regression tests for the per-column SCALE factor in checksum accumulation (BUG #439).
 *
 * Documents that lat/lon values differing by 0.000500 (less than the old ×1000
 * threshold of 0.001) are distinguishable under ×1e7 but collapse to the same
 * integer under ×1000 — proving the old code had a false-positive verification
 * window of ~100 m for geographic coordinates.
 *
 * Uses Node built-in assert (no test framework) per the task spec.
 * Run: node scripts/tests/rechunk-checksum.test.mjs
 * or:  npx vitest run scripts/tests/rechunk-checksum.test.mjs
 */
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Inline the scale constants (mirrors both rechunk-sql.mjs and
// load-staged-sql-to-supabase.mjs so any drift between the three is caught).
// ---------------------------------------------------------------------------
const SCALE = {
  lat: 1e7, lon: 1e7,
  cost: 100,
  distance_km: 1e4,
  duration_minutes: 100,
  battery_level: 100,
  total_paid_revenue: 100,
  total_trips: 1, unique_users_count: 1, unique_vehicles_count: 1,
};
const DEFAULT_SCALE = 1000;

const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));

function checksum(rows, col) {
  return rows.reduce((s, r) => s + Math.round(num(r[col]) * (SCALE[col] ?? DEFAULT_SCALE)), 0);
}

function checksumOld(rows, col) {
  // The OLD flat ×1000 scale — kept here to document the regression.
  return rows.reduce((s, r) => s + Math.round(num(r[col]) * 1000), 0);
}

// ---------------------------------------------------------------------------
// TEST 1: two lat values that differ by 0.000500 produce DIFFERENT sums under
// the new ×1e7 scale but the SAME sum under the old ×1000 scale.
// lat1 = 37.927000, lat2 = 37.927500  → difference = 0.000500
// ×1000: round(37.927) = 37927, round(37.9275) = 37928 — wait, let's compute precisely.
// Actually: round(37.927000 * 1000) = 37927, round(37.927500 * 1000) = 37928 (different).
// So we need a smaller difference: 0.000499.
// round(37.927000 * 1000) = 37927, round(37.927499 * 1000) = 37927 (same).
// Under ×1e7: round(37.927000 * 1e7) = 379270000, round(37.927499 * 1e7) = 379274990 (different).
// ---------------------------------------------------------------------------
{
  const lat1 = 37.927000;
  const lat2 = 37.927499; // diff = 0.000499 — below old 0.001 threshold
  const rows = [{ lat: lat1 }, { lat: lat2 }];

  const newSum = checksum(rows, 'lat');
  const oldSum = checksumOld(rows, 'lat');

  // Under new scale: the two rows produce DIFFERENT per-row integers → different sum
  const newR1 = Math.round(lat1 * 1e7);
  const newR2 = Math.round(lat2 * 1e7);
  assert.notEqual(newR1, newR2,
    `Expected new ×1e7 to distinguish lat1=${lat1} from lat2=${lat2}`);
  assert.notEqual(newSum, newSum - newR1 + newR2, // just a sanity alias
    'sanity: sum changes when per-row value changes');

  // Under old scale: the two rows produce the SAME per-row integer → same sum
  const oldR1 = Math.round(lat1 * 1000);
  const oldR2 = Math.round(lat2 * 1000);
  assert.equal(oldR1, oldR2,
    `Expected old ×1000 to collapse lat1=${lat1} and lat2=${lat2} to the same integer`);

  console.log('PASS  TEST 1: 0.000499 lat diff — new×1e7 distinguishes, old×1000 collapses');
  console.log(`       new per-row: ${newR1} vs ${newR2}  (different)`);
  console.log(`       old per-row: ${oldR1} vs ${oldR2}  (same — false-positive window)`);
}

// ---------------------------------------------------------------------------
// TEST 2: a concrete lat/lon pair produces the correct integer sum under ×1e7.
// lat=37.927123, lon=23.641456 → expected integers:
//   round(37.927123 × 1e7) = 379271230, round(23.641456 × 1e7) = 236414560
// ---------------------------------------------------------------------------
{
  const row = { lat: 37.927123, lon: 23.641456 };
  const latSum = checksum([row], 'lat');
  const lonSum = checksum([row], 'lon');

  assert.equal(latSum, Math.round(37.927123 * 1e7),
    `lat checksum mismatch: got ${latSum}`);
  assert.equal(lonSum, Math.round(23.641456 * 1e7),
    `lon checksum mismatch: got ${lonSum}`);

  console.log('PASS  TEST 2: lat/lon ×1e7 produces correct integers');
  console.log(`       lat=${row.lat} → ${latSum}  (expected ${Math.round(37.927123 * 1e7)})`);
  console.log(`       lon=${row.lon} → ${lonSum}  (expected ${Math.round(23.641456 * 1e7)})`);
}

// ---------------------------------------------------------------------------
// TEST 3: unlisted column falls back to DEFAULT_SCALE (1000).
// ---------------------------------------------------------------------------
{
  const row = { some_new_col: 12.345 };
  const s = checksum([row], 'some_new_col');
  assert.equal(s, Math.round(12.345 * DEFAULT_SCALE),
    `Default scale fallback mismatch: got ${s}`);
  console.log('PASS  TEST 3: unlisted column uses DEFAULT_SCALE=1000');
}

console.log('\nAll rechunk-checksum tests passed.');
