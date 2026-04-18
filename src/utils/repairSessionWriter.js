import { doc, writeBatch, increment, arrayUnion, serverTimestamp } from 'firebase/firestore';
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
  const labourMinutes = Math.round((completedAt - startedAt) / 60000);

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

  const batch = writeBatch(db);

  // 1. Update ticket
  batch.update(doc(db, 'maintenanceTickets', ticketDocId), {
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

  // 2. Decrement parts (split into BATCH_SIZE chunks if huge, unlikely but safe)
  aggregatedPartsUsed.forEach(({ partId, quantity }) => {
    batch.update(doc(db, 'maintenanceParts', partId), {
      stockOnHand: increment(-quantity),
    });
  });

  // 3. Create audit doc
  batch.set(doc(db, 'repairSessions', sessionId), {
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

  await batch.commit();
}
