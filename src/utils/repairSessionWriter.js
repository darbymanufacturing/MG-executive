import { doc, increment, arrayUnion, serverTimestamp, runTransaction } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { getActiveOrg } from '../hooks/orgWrite.js';

/**
 * Writes back a completed repair session in one atomic batch:
 *  - maintenanceTickets: mark Completed, store partsUsed + labour
 *  - maintenanceParts:   decrement stockOnHand for every part consumed
 *  - repairSessions:     create permanent audit doc
 */
export async function completeRepairSession({
  ticketDocId,
  sessionId,
  procedureId,
  scooterId,
  technicianUid,
  technicianName,
  startedAt,       // Date
  completedAt,     // Date
  steps,           // [{ stepNumber, notes, partsUsed: [{partId, partName, quantity, unitCost}], photoUrls }]
}) {
  // ADR-0003: every write must be scoped to an org
  const orgId = getActiveOrg();
  if (!orgId) throw new Error('repairSessionWriter: no active orgId — write blocked (ADR-0003).');

  // #184 — coerce to Date before subtraction; string inputs cause NaN
  const startMs = new Date(startedAt).getTime();
  const endMs   = new Date(completedAt).getTime();
  const labourMinutes = Number.isFinite(startMs) && Number.isFinite(endMs)
    ? Math.round((endMs - startMs) / 60000)
    : 0;

  // Aggregate parts across all steps
  const partMap = {};
  steps.forEach((step) => {
    (step.partsUsed ?? []).forEach(({ partId, partName, quantity, unitCost }) => {
      if (!partId || !quantity) return;
      if (!partMap[partId]) partMap[partId] = { partId, partName, quantity: 0, unitCost: unitCost ?? 0 };
      partMap[partId].quantity += quantity;
    });
  });
  const aggregatedPartsUsed = Object.values(partMap);
  const totalPartsCost = aggregatedPartsUsed.reduce(
    (sum, p) => sum + p.quantity * (p.unitCost ?? 0), 0
  );

  // #402/#23/#24 — All writes happen in ONE transaction so the entire operation is
  // atomic. If the ticket update or session doc write fails, the stock decrements are
  // automatically rolled back. The previous split (transaction for stock + writeBatch
  // for ticket/session) left a window where stock could be decremented but the ticket
  // remain "In Progress". At typical repair part counts (< 50 distinct parts) total
  // ops are well under the 500 transaction limit.
  await runTransaction(db, async (transaction) => {
    // Read ticket first — also puts it in the transaction read-set so Firestore
    // will abort/retry if another concurrent transaction modifies it (BUG-422).
    const ticketRef = doc(db, 'maintenanceTickets', ticketDocId);
    const ticketSnap = await transaction.get(ticketRef);
    if (!ticketSnap.exists()) throw new Error(`Ticket ${ticketDocId} not found`);
    const ticketStatus = ticketSnap.data().status;
    if (ticketStatus === 'Completed') {
      const doneBy = ticketSnap.data().completedBy ?? 'another technician';
      throw new Error(`Ticket already completed by ${doneBy}`);
    }

    // Read all part docs (all reads must precede writes in a transaction)
    const partRefs = aggregatedPartsUsed.map(({ partId }) =>
      doc(db, 'maintenanceParts', partId)
    );
    const partSnaps = await Promise.all(partRefs.map((ref) => transaction.get(ref)));

    // Validate stock for every part before writing anything
    partSnaps.forEach((snap, idx) => {
      const { partId, partName, quantity } = aggregatedPartsUsed[idx];
      const currentStock = snap.exists() ? (snap.data().stockOnHand ?? 0) : 0;
      if (currentStock < quantity) {
        throw new Error(`Insufficient stock for ${partName ?? partId}: have ${currentStock}, need ${quantity}`);
      }
    });

    // All stock checks passed — decrement each part
    partSnaps.forEach((snap, idx) => {
      const { quantity } = aggregatedPartsUsed[idx];
      transaction.update(snap.ref, { stockOnHand: increment(-quantity) });
    });

    // Update ticket in the same transaction — reuse ticketRef (same ref that was read)
    // so Firestore includes it in the transaction's read-set and enforces the guard.
    transaction.update(ticketRef, {
      status:         'Completed',
      dateCompleted:  completedAt.toISOString().slice(0, 10),
      completedBy:    technicianUid,
      partsUsed:      aggregatedPartsUsed,
      labourMinutes,
      sessionId,
      updatedAt:      completedAt.toISOString(),
      activityLog:    arrayUnion({
        timestamp: completedAt.toISOString(),
        action:    'Repair completed by technician',
        by:        technicianName,
      }),
    });

    // Create audit doc in the same transaction
    transaction.set(doc(db, 'repairSessions', sessionId), {
      orgId,                             // ADR-0003: scope every doc to its org
      ticketId:          ticketDocId,
      scooterId,
      procedureId:       procedureId ?? null,
      technicianUid,
      technicianName,
      startedAt:         startedAt.toISOString(),
      completedAt:       completedAt.toISOString(),
      labourMinutes,
      steps:             steps.map((s) => ({
        stepNumber:  s.stepNumber,
        completedAt: s.completedAt ?? completedAt.toISOString(),
        partsUsed:   s.partsUsed ?? [],
        notes:       s.notes ?? '',
        photoUrls:   s.photoUrls ?? [],
      })),
      aggregatedPartsUsed,
      totalPartsCost,
      createdAt: serverTimestamp(),
    });
  });
}
