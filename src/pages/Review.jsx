import { useMemo, useState } from 'react';
import { Check, X, Inbox as InboxIcon, Loader2, AlertTriangle } from 'lucide-react';
import Header from '../components/Layout/Header.jsx';
import EmptyState from '../components/Shared/EmptyState.jsx';
import { useIntake } from '../context/IntakeContext.jsx';
import { CATEGORIES } from '../utils/constants.js';
import { missingForApproval } from '../utils/intake.js';
import { formatEUR } from '../utils/formatters.js';
import styles from './Review.module.css';

/**
 * /review — the one place the owner clears everything the automations weren't
 * sure about (docs/AUTOMATION_PLAN.md §3.3). Confident items never reach here;
 * they are already in the books with an undo.
 *
 * Built to be cleared fast: each row shows the decision-relevant facts inline
 * (what, how much, when, where it came from, why it was held) and asks only for
 * the ONE thing that type of record still needs — a category for an expense,
 * who paid for a personal payment, a scooter for a repair. No modals.
 */

const SOURCE_LABELS = {
  wallet: 'Bank',
  mydata: 'myDATA',
  gmail: 'Email',
  whatsapp: 'WhatsApp',
  hopp_csv: 'Hopp',
  rule: 'Rule',
};

const KIND_LABELS = {
  cost: 'Expense',
  ledger: 'Paid personally',
  ticket: 'Repair',
  issue: 'Issue',
  task: 'Task',
  parts_receipt: 'Parts delivery',
  loan_payment: 'Loan payment',
  revenue_import: 'Revenue',
};

const NEEDS_CATEGORY = new Set(['cost', 'ledger']);

export default function Review() {
  const {
    pending, recentlyHandled, bySource, owners, loading, error,
    approve, approveMany, reject,
  } = useIntake();
  const [busyId, setBusyId] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [edits, setEdits] = useState({});
  const [failure, setFailure] = useState(null);

  const categoryKeys = useMemo(() => Object.keys(CATEGORIES), []);

  const pendingTotal = useMemo(
    () => pending.reduce((sum, i) => sum + (Number(i.payload?.amount) || 0), 0),
    [pending],
  );

  /** Default owner for "paid personally": whoever the WhatsApp sender is. */
  const defaultOwnerFor = (item) => {
    const name = String(item.evidence?.senderName || '').toLowerCase();
    if (!name) return owners.length === 1 ? owners[0]._docId : '';
    const match = owners.find((o) => String(o.displayName || '').toLowerCase().includes(name));
    return match?._docId || '';
  };

  /** The overrides this row will be approved with (edits win over defaults). */
  const overridesFor = (item) => {
    const e = edits[item._docId] || {};
    const p = item.payload || {};
    const out = {};
    if (NEEDS_CATEGORY.has(item.kind)) out.category = e.category ?? p.category ?? '';
    if (item.kind === 'ledger') out.ownerUid = e.ownerUid ?? p.ownerUid ?? defaultOwnerFor(item);
    if (item.kind === 'ticket') out.scooterId = e.scooterId ?? p.scooterId ?? '';
    return out;
  };

  const setEdit = (item, field, value) =>
    setEdits((prev) => ({ ...prev, [item._docId]: { ...(prev[item._docId] || {}), [field]: value } }));

  const run = async (item, fn) => {
    setBusyId(item._docId);
    setFailure(null);
    try {
      await fn();
    } catch (err) {
      setFailure(err?.message || String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleApprove = (item) => run(item, () => approve(item, overridesFor(item)));
  const handleReject = (item) => run(item, () => reject(item));

  const readyItems = pending.filter((i) => !missingForApproval(i, overridesFor(i)));

  const handleApproveAll = async () => {
    if (!readyItems.length) return;
    setBulkBusy(true);
    setFailure(null);
    try {
      const res = await approveMany(readyItems.map((item) => ({ item, overrides: overridesFor(item) })));
      if (res.failed.length) setFailure(`${res.failed.length} item(s) could not be approved: ${res.failed[0].error}`);
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <Header title="Review" subtitle="Everything the automations weren't sure about" />

      <div className={styles.content}>
        {error && (
          <div className={styles.notice}>
            <AlertTriangle size={16} />
            <span>
              The review queue isn&rsquo;t available yet: <code>{error}</code>. If this says the
              table is missing, apply <code>supabase/migrations/autopilot_intake_items.sql</code>.
            </span>
          </div>
        )}

        {failure && (
          <div className={`${styles.notice} ${styles.noticeError}`}>
            <AlertTriangle size={16} />
            <span>{failure}</span>
          </div>
        )}

        <div className={styles.summary}>
          <div className={styles.summaryMain}>
            <span className={styles.count}>{pending.length}</span>
            <span className={styles.countLabel}>waiting for you</span>
            {pendingTotal > 0 && <span className={styles.total}>{formatEUR(pendingTotal)}</span>}
          </div>
          <div className={styles.sources}>
            {Object.entries(bySource).map(([source, n]) => (
              <span key={source} className={styles.sourceChip}>
                {SOURCE_LABELS[source] || source} · {n}
              </span>
            ))}
          </div>
          {pending.length > 1 && (
            <button
              type="button"
              className={styles.bulkBtn}
              onClick={handleApproveAll}
              disabled={bulkBusy || readyItems.length === 0}
              title={readyItems.length === 0 ? 'Fill in the highlighted field on each row first' : undefined}
            >
              {bulkBusy ? <Loader2 size={15} className={styles.spin} /> : <Check size={15} />}
              Approve {readyItems.length} ready
            </button>
          )}
        </div>

        {loading && pending.length === 0 && <p className={styles.muted}>Loading…</p>}

        {!loading && pending.length === 0 && !error && (
          <EmptyState
            icon={InboxIcon}
            title="Nothing to review"
            description="Every automatic import was confident enough to file itself. New items appear here the moment something needs your call."
          />
        )}

        {pending.length > 0 && (
          <ul className={styles.list}>
            {pending.map((item) => {
              const p = item.payload || {};
              const busy = busyId === item._docId;
              const o = overridesFor(item);
              const missing = missingForApproval(item, o);
              const showAmount = Number(p.amount) > 0;
              return (
                <li key={item._docId} className={styles.row}>
                  <div className={styles.rowMain}>
                    <div className={styles.rowTop}>
                      <span className={styles.name}>
                        <span className={styles.kindTag}>{KIND_LABELS[item.kind] || item.kind}</span>
                        {p.name || 'Unnamed'}
                      </span>
                      {showAmount && <span className={styles.amount}>{formatEUR(Number(p.amount))}</span>}
                    </div>
                    <div className={styles.rowMeta}>
                      <span>{p.date || '—'}</span>
                      <span className={styles.sourceTag}>{SOURCE_LABELS[item.source] || item.source}</span>
                      {item.evidence?.senderName && <span>from {item.evidence.senderName}</span>}
                      {p.vatAmount != null && <span>VAT {formatEUR(Number(p.vatAmount))}</span>}
                      {item.evidence?.filename && <span>{item.evidence.filename}</span>}
                      {item.kind === 'ticket' && p.completed && <span>repair done</span>}
                      {p.minutes ? <span>{p.minutes} min</span> : null}
                    </div>
                    {item.evidence?.transcript && (
                      <p className={styles.transcript}>&ldquo;{item.evidence.transcript}&rdquo;</p>
                    )}
                    {item.reasons?.length > 0 && (
                      <p className={styles.reason}>{item.reasons.join(' · ')}</p>
                    )}
                  </div>

                  <div className={styles.rowActions}>
                    {item.kind === 'ledger' && (
                      <>
                        <label className={styles.srOnly} htmlFor={`owner-${item._docId}`}>Who paid</label>
                        <select
                          id={`owner-${item._docId}`}
                          className={`${styles.select} ${missing === 'Who paid' ? styles.needs : ''}`}
                          value={o.ownerUid}
                          onChange={(e) => setEdit(item, 'ownerUid', e.target.value)}
                          disabled={busy}
                        >
                          <option value="">Who paid?</option>
                          {owners.map((ow) => (
                            <option key={ow._docId} value={ow._docId}>{ow.displayName || ow.email}</option>
                          ))}
                        </select>
                      </>
                    )}

                    {NEEDS_CATEGORY.has(item.kind) && (
                      <>
                        <label className={styles.srOnly} htmlFor={`cat-${item._docId}`}>Category</label>
                        <select
                          id={`cat-${item._docId}`}
                          className={`${styles.select} ${missing === 'Category' ? styles.needs : ''}`}
                          value={o.category}
                          onChange={(e) => setEdit(item, 'category', e.target.value)}
                          disabled={busy}
                        >
                          <option value="">Choose a category…</option>
                          {categoryKeys.map((key) => (
                            <option key={key} value={key}>{CATEGORIES[key].label || key}</option>
                          ))}
                        </select>
                      </>
                    )}

                    {item.kind === 'ticket' && (
                      <>
                        <label className={styles.srOnly} htmlFor={`sc-${item._docId}`}>Scooter ID</label>
                        <input
                          id={`sc-${item._docId}`}
                          className={`${styles.input} ${missing === 'Scooter ID' ? styles.needs : ''}`}
                          value={o.scooterId}
                          onChange={(e) => setEdit(item, 'scooterId', e.target.value.replace(/\D/g, ''))}
                          placeholder="Scooter ID"
                          inputMode="numeric"
                          disabled={busy}
                        />
                      </>
                    )}

                    <button
                      type="button"
                      className={styles.approve}
                      onClick={() => handleApprove(item)}
                      disabled={busy || Boolean(missing)}
                      title={missing ? `Missing: ${missing}` : 'Approve'}
                    >
                      {busy ? <Loader2 size={15} className={styles.spin} /> : <Check size={15} />}
                      Approve
                    </button>
                    <button
                      type="button"
                      className={styles.rejectBtn}
                      onClick={() => handleReject(item)}
                      disabled={busy}
                      title="Not needed — ignore"
                      aria-label="Reject"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {recentlyHandled.length > 0 && (
          <section className={styles.handled}>
            <h2 className={styles.handledTitle}>Recently handled</h2>
            <ul className={styles.handledList}>
              {recentlyHandled.slice(0, 12).map((item) => (
                <li key={item._docId} className={styles.handledRow}>
                  <span className={styles.handledName}>{item.payload?.name}</span>
                  <span className={styles.handledMeta}>
                    {SOURCE_LABELS[item.source] || item.source} · {String(item.status).replace('_', ' ')}
                  </span>
                  {Number(item.payload?.amount) > 0 && (
                    <span className={styles.handledAmount}>{formatEUR(Number(item.payload.amount))}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
