import { createContext, useContext, useMemo, useCallback } from 'react';
import { serverTimestamp } from 'firebase/firestore';
import { useOrgCollection } from '../hooks/useOrgCollection.js';
import { orgUpdate } from '../hooks/orgWrite.js';
import { useAuth } from './AuthContext.jsx';

const RepairSessionContext = createContext(null);

const SESSIONS_COL = 'repairSessions';
const TICKETS_COL = 'maintenanceTickets';

export function RepairSessionProvider({ children }) {
  const { user, userProfile } = useAuth();

  // Phase 2 (ADR-0003): org-scoped read. useOrgCollection injects
  // where('orgId','==',orgId) and throws if the org resolved but is absent.
  const { items, loading, error } = useOrgCollection(SESSIONS_COL, {
    orderBy: ['completedAt', 'desc'],
    limit: 100,
  });

  // Preserve the public shape: consumers read `.id` (was the Firestore doc id).
  const sessions = useMemo(
    () => items.map(({ _docId, ...rest }) => ({ id: _docId, ...rest })),
    [items],
  );

  // Phase 2.5 F2 — sessions awaiting admin cost-approval (most recent first).
  const pendingApprovals = useMemo(
    () => sessions.filter((s) => (s.costStatus ?? 'pending') === 'pending'),
    [sessions],
  );

  // Phase 2.5 F2 — approve a completed repair's cost. Stamps the session AND mirrors
  // the status onto the ticket so both surfaces agree. orgUpdate enforces org scope
  // + routes through safeWrite (toast on failure).
  const approveSession = useCallback(async (session) => {
    if (!session?.id) throw new Error('approveSession: missing session id');
    const approver = userProfile?.displayName || user?.email || 'admin';
    const patch = {
      costStatus: 'approved',
      approvedBy: approver,
      approvedAt: serverTimestamp(),
      rejectionReason: null,
    };
    await orgUpdate(SESSIONS_COL, session.id, patch, { rethrow: true, errorMessage: 'Failed to approve repair cost' });
    if (session.ticketId) {
      await orgUpdate(TICKETS_COL, session.ticketId, { costStatus: 'approved' }, { errorMessage: 'Cost approved, but updating the ticket failed' });
    }
  }, [user, userProfile]);

  // Phase 2.5 F2 — reject with a reason the technician sees.
  const rejectSession = useCallback(async (session, reason) => {
    if (!session?.id) throw new Error('rejectSession: missing session id');
    const approver = userProfile?.displayName || user?.email || 'admin';
    const patch = {
      costStatus: 'rejected',
      approvedBy: approver,
      approvedAt: serverTimestamp(),
      rejectionReason: (reason || '').trim() || 'No reason given',
    };
    await orgUpdate(SESSIONS_COL, session.id, patch, { rethrow: true, errorMessage: 'Failed to reject repair cost' });
    if (session.ticketId) {
      // Mirror status + reason onto the ticket so the technician's dashboard shows why.
      await orgUpdate(TICKETS_COL, session.ticketId, { costStatus: 'rejected', rejectionReason: patch.rejectionReason }, { errorMessage: 'Cost rejected, but updating the ticket failed' });
    }
  }, [user, userProfile]);

  const value = useMemo(
    () => ({
      sessions,
      pendingApprovals,
      loading,
      snapshotError: error ? error.message : null,
      approveSession,
      rejectSession,
    }),
    [sessions, pendingApprovals, loading, error, approveSession, rejectSession],
  );

  return (
    <RepairSessionContext.Provider value={value}>
      {children}
    </RepairSessionContext.Provider>
  );
}

export function useRepairSessions() {
  return useContext(RepairSessionContext);
}
