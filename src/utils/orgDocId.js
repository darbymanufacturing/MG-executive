/**
 * orgDocId — the single canonical builder for org-prefixed Firestore document IDs
 * (ADR-0002 multi-tenancy). Deterministic doc IDs (scooter codes, dates, SKUs)
 * are NOT globally unique across orgs — two operators can both own scooter "70055"
 * or have a "2026-01-01" revenue day — so every such ID is prefixed with the org:
 *
 *   orgDocId('acme', '70055')                 → 'acme_70055'
 *   orgDocId('acme', '2026-01-01', 'Corinth') → 'acme_2026-01-01_Corinth'
 *
 * The tail is sanitized the same way the pre-Phase-2 code sanitized raw ids
 * (Firestore forbids / . # $ [ ] in doc ids), so migrating an existing doc via
 * `orgDocId(orgId, oldId)` yields exactly `${orgId}_${oldId}` for already-clean ids
 * — the invariant the B6 backfill relies on (new-write id === migrated id).
 *
 * INVARIANT: throws without an orgId — a deterministic-id write must never land
 * unscoped (it would collide across orgs). Mirrors the orgWrite fail-loud rule.
 */
const FORBIDDEN = /[/.#$[\]]/g;

export function orgDocId(orgId, ...parts) {
  if (!orgId) throw new Error('orgDocId: orgId is required (deterministic ids must be org-scoped).');
  const tail = parts
    .map((p) => String(p ?? ''))
    .join('_')
    .replace(FORBIDDEN, '_');
  if (!tail.replace(/_/g, '').trim()) {
    throw new Error('orgDocId: tail must be non-empty (received only empty/undefined parts).');
  }
  return `${orgId}_${tail}`;
}
