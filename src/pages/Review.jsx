import { useMemo, useState } from 'react';
import {
  Check, X, Inbox as InboxIcon, Loader2, AlertTriangle, Undo2, GitMerge, RefreshCw, Landmark,
} from 'lucide-react';
import Header from '../components/Layout/Header.jsx';
import EmptyState from '../components/Shared/EmptyState.jsx';
import { useIntake } from '../context/IntakeContext.jsx';
import { useMaintenance } from '../context/MaintenanceContext.jsx';
import { CATEGORIES } from '../utils/constants.js';
import { missingForApproval, canonicalCategory } from '../utils/intake.js';
import { matchPartsByName } from '../utils/maintenanceAutomation.js';
import { LEDGER_ENTRY_TYPES } from '../utils/ownerLedger.js';
import { formatEUR } from '../utils/formatters.js';
import styles from './Review.module.css';

/**
 * /review — the one place the owner clears everything the automations weren't
 * sure about (docs/AUTOMATION_PLAN.md §3.3), and undoes anything they did on
 * their own. The same queue is also clearable from WhatsApp ("review", "✅").
 *
 * Built to be cleared fast: each row shows the decision-relevant facts inline
 * (what, how much, when, where it came from, why it was held) and asks only for
 * what that kind of record still needs. No modals.
 */

const SOURCE_LABELS = {
  wallet: 'Bank',
  mydata: 'myDATA',
  gmail: 'Email',
  whatsapp: 'WhatsApp',
  hopp_csv: 'Hopp',
  rule: 'Rule',
  capture: 'Capture',
};

const KIND_LABELS = {
  cost: 'Expense',
  ledger: 'Owner money',
  ticket: 'Repair',
  issue: 'Issue',
  task: 'Task',
  parts_receipt: 'Parts delivery',
  loan_payment: 'Loan payment',
  recurring: 'Recurring bill',
  revenue_import: 'Revenue',
};

/** Ledger kinds the queue can produce (a settle-up "repayment" is entered on the Ledger page). */
const LEDGER_CHOICES = ['expense_reimbursable', 'salary_payment', 'drawing', 'capital_injection', 'salary_accrual'];

const NEEDS_CATEGORY = new Set(['cost', 'recurring']);
const isUnnamedSupplier = (item) => item.kind === 'cost' && /^ΑΦΜ\s/.test(String(item.payload?.name || ''));
const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));

function relTime(isoStr) {
  if (!isoStr) return 'never';
  const mins = Math.round((Date.now() - Date.parse(isoStr)) / 60000);
  if (!Number.isFinite(mins)) return 'never';
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}

function SyncPanel({ autopilot, syncNow }) {
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const last = autopilot.lastSync || {};
  const cash = autopilot.walletCash;

  const run = async (feed, opts) => {
    setBusy(feed);
    setNote(null);
    try {
      const r = await syncNow(feed, opts);
      const parts = [
        r.fetched != null ? `${r.fetched} records` : null,
        r.invoices != null ? `${r.invoices} invoices` : null,
        r.auto ? `${r.auto} logged` : null,
        r.settled ? `${r.settled} marked paid` : null,
        r.held ? `${r.held} to review` : null,
        r.recurringSuggested ? `${r.recurringSuggested} recurring bills found` : null,
        r.salaryAccruals ? `${r.salaryAccruals} salary accruals` : null,
      ].filter(Boolean);
      setNote({ ok: true, text: `Done — ${parts.join(' · ') || 'nothing new'}.` });
    } catch (err) {
      setNote({ ok: false, text: err.message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={styles.syncPanel} aria-label="Automatic feeds">
      <div className={styles.syncFeeds}>
        <div className={styles.syncFeed}>
          <span className={styles.syncName}>Bank (Wallet)</span>
          <span className={styles.syncWhen}>synced {relTime(last.wallet?.at)}</span>
          <button type="button" className={styles.syncBtn} onClick={() => run('wallet')} disabled={Boolean(busy)}>
            {busy === 'wallet' ? <Loader2 size={13} className={styles.spin} /> : <RefreshCw size={13} />} Sync now
          </button>
        </div>
        <div className={styles.syncFeed}>
          <span className={styles.syncName}>Supplier invoices (myDATA)</span>
          <span className={styles.syncWhen}>synced {relTime(last.mydata?.at)}</span>
          <button type="button" className={styles.syncBtn} onClick={() => run('mydata')} disabled={Boolean(busy)}>
            {busy === 'mydata' ? <Loader2 size={13} className={styles.spin} /> : <RefreshCw size={13} />} Sync now
          </button>
        </div>
        <div className={styles.syncFeed}>
          <span className={styles.syncName}>Recurring bills &amp; salaries</span>
          <span className={styles.syncWhen}>checked daily</span>
          <button type="button" className={styles.syncBtn} onClick={() => run('finance')} disabled={Boolean(busy)}>
            {busy === 'finance' ? <Loader2 size={13} className={styles.spin} /> : <RefreshCw size={13} />} Check now
          </button>
        </div>
      </div>

      <div className={styles.syncFoot}>
        {cash && (
          <span className={styles.cash} title={`Cash accounts in Wallet, ${new Date(cash.asOf).toLocaleString('el-GR')}`}>
            <Landmark size={13} aria-hidden="true" /> Bank today {formatEUR(cash.balance)}
          </span>
        )}
        <div className={styles.backfill}>
          <label htmlFor="review-backfill-from">Back-fill history from</label>
          <input
            id="review-backfill-from"
            type="date"
            className={styles.input}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <button
            type="button"
            className={styles.syncBtn}
            disabled={Boolean(busy) || !from}
            onClick={async () => { await run('wallet', { from }); await run('mydata', { from }); }}
          >
            Back-fill
          </button>
        </div>
      </div>
      {note && <p className={note.ok ? styles.syncOk : styles.syncErr}>{note.text}</p>}
    </section>
  );
}

export default function Review() {
  const {
    pending, recentlyHandled, bySource, owners, autopilot, loading, error,
    approve, approveMany, reject, merge, undo, syncNow,
  } = useIntake();
  const { parts: catalog } = useMaintenance();
  const [busyId, setBusyId] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [edits, setEdits] = useState({});
  const [failure, setFailure] = useState(null);

  const categoryKeys = useMemo(() => Object.keys(CATEGORIES), []);

  const pendingTotal = useMemo(
    () => pending.reduce((sum, i) => sum + (Number(i.payload?.amount) || 0), 0),
    [pending],
  );

  /** Default owner for owner-money items: whoever sent it, else the only owner. */
  const defaultOwnerFor = (item) => {
    const name = String(item.evidence?.senderName || '').toLowerCase();
    if (!name) return owners.length === 1 ? owners[0]._docId : '';
    const match = owners.find((o) => String(o.displayName || '').toLowerCase().includes(name));
    return match?._docId || '';
  };

  /** The overrides this row will be approved with (edits win over the item's own values). */
  const overridesFor = (item) => {
    const e = edits[item._docId] || {};
    const p = item.payload || {};
    const out = {};
    if (NEEDS_CATEGORY.has(item.kind)) out.category = e.category ?? p.category ?? '';
    if (isUnnamedSupplier(item) && e.name) out.name = e.name;
    if (item.kind === 'ledger') {
      out.ownerUid = e.ownerUid ?? p.ownerUid ?? defaultOwnerFor(item);
      out.ledgerType = e.ledgerType ?? p.ledgerType ?? 'expense_reimbursable';
      if (out.ledgerType === 'expense_reimbursable') out.category = e.category ?? p.category ?? '';
    }
    if (item.kind === 'ticket') out.scooterId = e.scooterId ?? p.scooterId ?? '';
    if (item.kind === 'loan_payment') {
      out.interest = e.interest != null ? num(e.interest) : p.interest;
      out.principal = e.principal != null ? num(e.principal) : p.principal;
    }
    if (item.kind === 'parts_receipt' && !(p.parts || []).length) {
      out.parts = matchPartsByName(p.partNames || [], catalog || []).matched
        .map((m) => ({ partId: m.partId, qty: m.quantity, name: m.partName }));
    }
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

  const categorySelect = (item, o, missing, busy) => (
    <>
      <label className={styles.srOnly} htmlFor={`cat-${item._docId}`}>Category</label>
      <select
        id={`cat-${item._docId}`}
        className={`${styles.select} ${missing === 'Category' ? styles.needs : ''}`}
        value={canonicalCategory(o.category) || ''}
        onChange={(e) => setEdit(item, 'category', e.target.value)}
        disabled={busy}
      >
        <option value="">Choose a category…</option>
        {categoryKeys.map((key) => (
          <option key={key} value={key}>{CATEGORIES[key].label || key}</option>
        ))}
      </select>
    </>
  );

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

        <SyncPanel autopilot={autopilot} syncNow={syncNow} />

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
              const maybeDup = item.match?.type === 'possible_duplicate';
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
                      {p.categoryGuess && !p.category && <span>guessed &ldquo;{p.categoryGuess}&rdquo;</span>}
                      {item.evidence?.filename && <span>{item.evidence.filename}</span>}
                      {item.evidence?.fileUrl && (
                        <a href={item.evidence.fileUrl} target="_blank" rel="noreferrer">receipt</a>
                      )}
                      {item.kind === 'ticket' && p.completed && <span>repair done</span>}
                      {p.minutes ? <span>{p.minutes} min</span> : null}
                      {item.kind === 'recurring' && p.nextDate && <span>monthly from {p.nextDate}</span>}
                      {item.kind === 'loan_payment' && p.loanName && <span>{p.loanName}</span>}
                    </div>
                    {item.evidence?.transcript && (
                      <p className={styles.transcript}>&ldquo;{item.evidence.transcript}&rdquo;</p>
                    )}
                    {item.reasons?.length > 0 && (
                      <p className={styles.reason}>{item.reasons.join(' · ')}</p>
                    )}
                    {item.kind === 'parts_receipt' && (
                      <p className={styles.reason}>
                        {(o.parts || p.parts || []).length
                          ? `Adds to stock: ${(o.parts || p.parts).map((x) => `${x.qty} × ${x.name || x.partId}`).join(', ')}`
                          : `No catalog match for: ${(p.partNames || []).join(', ') || '—'} — add the part to the catalog first.`}
                      </p>
                    )}
                  </div>

                  <div className={styles.rowActions}>
                    {isUnnamedSupplier(item) && (
                      <>
                        <label className={styles.srOnly} htmlFor={`sup-${item._docId}`}>Supplier name</label>
                        <input
                          id={`sup-${item._docId}`}
                          className={styles.input}
                          placeholder="Supplier name"
                          value={edits[item._docId]?.name ?? ''}
                          onChange={(e) => setEdit(item, 'name', e.target.value)}
                          disabled={busy}
                          title="Named once — every later invoice from this ΑΦΜ is named for you"
                        />
                      </>
                    )}

                    {item.kind === 'ledger' && (
                      <>
                        <label className={styles.srOnly} htmlFor={`owner-${item._docId}`}>Who</label>
                        <select
                          id={`owner-${item._docId}`}
                          className={`${styles.select} ${missing === 'Who paid' ? styles.needs : ''}`}
                          value={o.ownerUid}
                          onChange={(e) => setEdit(item, 'ownerUid', e.target.value)}
                          disabled={busy}
                        >
                          <option value="">Who?</option>
                          {owners.map((ow) => (
                            <option key={ow._docId} value={ow._docId}>{ow.displayName || ow.email}</option>
                          ))}
                        </select>
                        <label className={styles.srOnly} htmlFor={`lt-${item._docId}`}>Kind of owner money</label>
                        <select
                          id={`lt-${item._docId}`}
                          className={styles.select}
                          value={o.ledgerType}
                          onChange={(e) => setEdit(item, 'ledgerType', e.target.value)}
                          disabled={busy}
                        >
                          {LEDGER_CHOICES.map((t) => (
                            <option key={t} value={t}>{LEDGER_ENTRY_TYPES[t]?.label || t}</option>
                          ))}
                        </select>
                        {o.ledgerType === 'expense_reimbursable' && categorySelect(item, o, missing, busy)}
                      </>
                    )}

                    {NEEDS_CATEGORY.has(item.kind) && categorySelect(item, o, missing, busy)}

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

                    {item.kind === 'loan_payment' && (
                      <>
                        <label className={styles.srOnly} htmlFor={`int-${item._docId}`}>Interest</label>
                        <input
                          id={`int-${item._docId}`}
                          className={`${styles.input} ${styles.small} ${missing === 'Interest / principal split' ? styles.needs : ''}`}
                          value={edits[item._docId]?.interest ?? (p.interest ?? '')}
                          onChange={(e) => setEdit(item, 'interest', e.target.value)}
                          placeholder="Interest"
                          inputMode="decimal"
                          disabled={busy}
                          title="The interest part is a cost"
                        />
                        <label className={styles.srOnly} htmlFor={`pri-${item._docId}`}>Principal</label>
                        <input
                          id={`pri-${item._docId}`}
                          className={`${styles.input} ${styles.small} ${missing === 'Interest / principal split' ? styles.needs : ''}`}
                          value={edits[item._docId]?.principal ?? (p.principal ?? '')}
                          onChange={(e) => setEdit(item, 'principal', e.target.value)}
                          placeholder="Principal"
                          inputMode="decimal"
                          disabled={busy}
                          title="The principal part only lowers the loan balance — it is not a cost"
                        />
                      </>
                    )}

                    {maybeDup && (
                      <button
                        type="button"
                        className={styles.mergeBtn}
                        onClick={() => run(item, () => merge(item))}
                        disabled={busy}
                        title="It's the same money as the record named above — keep one"
                      >
                        <GitMerge size={14} /> Same payment
                      </button>
                    )}

                    <button
                      type="button"
                      className={styles.approve}
                      onClick={() => run(item, () => approve(item, o))}
                      disabled={busy || Boolean(missing)}
                      title={missing ? `Missing: ${missing}` : (maybeDup ? 'A different payment — add it' : 'Approve')}
                    >
                      {busy ? <Loader2 size={15} className={styles.spin} /> : <Check size={15} />}
                      {maybeDup ? 'Add as new' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      className={styles.rejectBtn}
                      onClick={() => run(item, () => reject(item))}
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
              {recentlyHandled.slice(0, 20).map((item) => {
                const canUndo = (item.status === 'auto_committed' || (item.status === 'merged' && item.decidedBy === 'autopilot'));
                return (
                  <li key={item._docId} className={styles.handledRow}>
                    <span className={styles.handledName}>{item.payload?.name}</span>
                    <span className={styles.handledMeta}>
                      {SOURCE_LABELS[item.source] || item.source} · {String(item.status).replace('_', ' ')}
                      {item.decidedVia === 'whatsapp' ? ' · via WhatsApp' : ''}
                    </span>
                    {Number(item.payload?.amount) > 0 && (
                      <span className={styles.handledAmount}>{formatEUR(Number(item.payload.amount))}</span>
                    )}
                    {canUndo && (
                      <button
                        type="button"
                        className={styles.undoBtn}
                        onClick={() => run(item, () => undo(item))}
                        disabled={busyId === item._docId}
                        title="Undo what Autopilot did and put it back in the queue"
                      >
                        <Undo2 size={13} /> Undo
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
