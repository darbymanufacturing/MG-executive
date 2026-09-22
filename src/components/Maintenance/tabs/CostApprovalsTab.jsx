import { useMemo, useState } from 'react';
import { CheckCircle2, XCircle, Clock, Euro, ChevronDown, ChevronUp } from 'lucide-react';
import { useRepairSessions } from '../../../context/RepairSessionContext.jsx';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import EmptyState from '../../Shared/EmptyState.jsx';
import styles from './CostApprovalsTab.module.css';

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('el-GR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return String(iso).slice(0, 16).replace('T', ' ');
  }
}

const eur = (n) => `€${Number(n ?? 0).toFixed(2)}`;

// Phase 2.5 F2 — one pending-approval card with the full cost breakdown + actions.
function ApprovalCard({ session, onApprove, onReject, busy }) {
  const [expanded, setExpanded] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const labour = session.labourCost ?? 0;
  const extra = session.extraCost ?? 0;
  const parts = session.totalPartsCost ?? 0;
  const total = session.totalCost ?? (labour + extra + parts);

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <span className={styles.scooter}>Scooter {session.scooterId || '—'}</span>
          <span className={styles.meta}>{session.technicianName || '—'} · {formatDate(session.completedAt)}</span>
        </div>
        <span className={styles.total}><Euro size={14} />{eur(total)}</span>
      </div>

      <button className={styles.breakdownToggle} onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Cost breakdown
      </button>
      {expanded && (
        <div className={styles.breakdown}>
          <div className={styles.row}><span>Parts</span><span>{eur(parts)}</span></div>
          <div className={styles.row}><span>Labour ({session.estimatedMinutes ?? 0} min est. @ {eur(session.labourRatePerHour)}/hr)</span><span>{eur(labour)}</span></div>
          {extra > 0 && (
            <div className={styles.row}>
              <span>Extra ({session.extraMinutes ?? 0} min){session.extraWorkNote ? ` — ${session.extraWorkNote}` : ''}</span>
              <span>{eur(extra)}</span>
            </div>
          )}
          <div className={`${styles.row} ${styles.rowTotal}`}><span>Total</span><span>{eur(total)}</span></div>
        </div>
      )}

      {rejecting ? (
        <div className={styles.rejectBox}>
          <textarea
            className={styles.reasonInput}
            rows={2}
            placeholder="Reason for rejection (the technician sees this)…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
          <div className={styles.actions}>
            <button className={styles.cancelBtn} onClick={() => { setRejecting(false); setReason(''); }} disabled={busy}>Cancel</button>
            <button className={styles.rejectConfirmBtn} onClick={() => onReject(session, reason)} disabled={busy || !reason.trim()}>
              <XCircle size={15} /> Confirm reject
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.actions}>
          <button className={styles.rejectBtn} onClick={() => setRejecting(true)} disabled={busy}>
            <XCircle size={15} /> Reject
          </button>
          <button className={styles.approveBtn} onClick={() => onApprove(session)} disabled={busy}>
            <CheckCircle2 size={15} /> Approve {eur(total)}
          </button>
        </div>
      )}
    </div>
  );
}

export default function CostApprovalsTab() {
  const { pendingApprovals: sessionApprovals, loading, approveSession, rejectSession } = useRepairSessions();
  const { tickets, updateTicket } = useMaintenance();
  const toast = useToast();
  const [busyId, setBusyId] = useState(null);

  /* Autopilot Phase 3 (#694) — repairs completed OUTSIDE the crew flow (admin
   * "Mark Completed" with time/parts, or a WhatsApp "done" message) carry their
   * cost on the ticket itself with costStatus 'pending' and no repair session.
   * They are reviewed here alongside technician sessions, in the same card. */
  const ticketApprovals = useMemo(() => (tickets || [])
    .filter((t) => t.costStatus === 'pending' && !t.sessionId && Number(t.totalCost) > 0)
    .map((t) => ({
      id: `ticket:${t._docId}`,
      kind: 'ticket',
      ticketDocId: t._docId,
      scooterId: t.scooterId,
      technicianName: t.source === 'autopilot-whatsapp' ? 'via WhatsApp' : 'Completed in Omni',
      completedAt: t.dateCompleted,
      labourCost: t.labourCost ?? 0,
      extraCost: 0,
      totalPartsCost: t.totalPartsCost ?? 0,
      totalCost: t.totalCost ?? 0,
      estimatedMinutes: t.labourMinutes ?? 0,
      labourRatePerHour: t.labourRatePerHour ?? 0,
    })), [tickets]);

  const pendingApprovals = useMemo(
    () => [...sessionApprovals, ...ticketApprovals],
    [sessionApprovals, ticketApprovals],
  );

  async function handleApprove(session) {
    setBusyId(session.id);
    try {
      if (session.kind === 'ticket') {
        await updateTicket(session.ticketDocId, { costStatus: 'approved', approvedAt: new Date().toISOString() });
      } else {
        await approveSession(session);
      }
      toast.success(`Approved €${Number(session.totalCost ?? 0).toFixed(2)} for scooter ${session.scooterId}`);
    } catch (err) {
      toast.error(err.message || 'Failed to approve');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(session, reason) {
    setBusyId(session.id);
    try {
      if (session.kind === 'ticket') {
        await updateTicket(session.ticketDocId, {
          costStatus: 'rejected',
          rejectionReason: reason,
          rejectedAt: new Date().toISOString(),
        });
      } else {
        await rejectSession(session, reason);
      }
      toast.info(`Rejected repair cost for scooter ${session.scooterId}`);
    } catch (err) {
      toast.error(err.message || 'Failed to reject');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <div className={styles.loading}>Loading approvals…</div>;
  }

  if (!pendingApprovals.length) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="No pending approvals"
        description="Completed repairs awaiting cost approval will appear here."
      />
    );
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.count}>
        <Clock size={14} /> {pendingApprovals.length} repair{pendingApprovals.length === 1 ? '' : 's'} awaiting cost approval
      </p>
      <div className={styles.list}>
        {pendingApprovals.map((s) => (
          <ApprovalCard
            key={s.id}
            session={s}
            onApprove={handleApprove}
            onReject={handleReject}
            busy={busyId === s.id}
          />
        ))}
      </div>
    </div>
  );
}
