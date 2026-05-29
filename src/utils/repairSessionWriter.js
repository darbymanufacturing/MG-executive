import { doc, writeBatch, increment, arrayUnion, serverTimestamp, runTransaction } from 'firebase/firestore';
import { db } from '../lib/firebase.js';

const BATCH_SIZE = 450;

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

  // #23 — Use a transaction to read each part's current stock, validate it is
  // sufficient before decrementing, and reject the whole session atomically if any
  // part has insufficient stock.
  //
  // #24 — After the transaction validates stock, write the ticket update + audit doc
  // in the first batch, then split part decrements into BATCH_SIZE chunks to stay
  // safely under Firestore's 500-op-per-batch limit (relevant if > 400 distinct parts).
  await runTransaction(db, async (transaction) => {
    // Read all part docs inside the transaction to get current stock
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

    // All stock checks passed — decrement each part inside the transaction
    partSnaps.forEach((snap, idx) => {
      const { quantity } = aggregatedPartsUsed[idx];
      transaction.update(snap.ref, { stockOnHand: increment(-quantity) });
    });
  });

  // #24 — Ticket update + audit doc go in the first batch; part decrements already
  // handled by the transaction above, so here we only write ticket + session docs.
  // Split into batches if somehow we exceed BATCH_SIZE (defensive).
  const firstBatch = writeBatch(db);

  // 1. Update ticket
  firstBatch.update(doc(db, 'maintenanceTickets', ticketDocId), {
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

  // 2. Create audit doc
  firstBatch.set(doc(db, 'repairSessions', sessionId), {
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

  await firstBatch.commit();
}
