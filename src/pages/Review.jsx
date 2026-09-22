import { useMemo, useState } from 'react';
import { Check, X, Inbox as InboxIcon, Loader2, AlertTriangle } from 'lucide-react';
import Header from '../components/Layout/Header.jsx';
import EmptyState from '../components/Shared/EmptyState.jsx';
import { useIntake } from '../context/IntakeContext.jsx';
import { CATEGORIES } from '../utils/constants.js';
import { formatEUR } from '../utils/formatters.js';
import styles from './Review.module.css';

/**
 * /review — the one place the owner clears everything the automations weren't
 * sure about (docs/AUTOMATION_PLAN.md §3.3). Confident items never reach here;
 * they are already in the books with an undo.
 *
 * The design goal is speed: the queue should be clearable in a minute, so each
 * row shows the decision-relevant facts inline (what, how much, when, where it
 * came from, why it was held) and the category is editable in place — no modal.
 */

const SOURCE_LABELS = {
  wallet: 'Bank',
  mydata: 'myDATA',
  gmail: 'Email',
  whatsapp: 'WhatsApp',
  hopp_csv: 'Hopp',
  rule: 'Rule',
};

export default function Review() {
  const { pending, recentlyHandled, bySource, loading, error, approve, approveMany, reject } = useIntake();
  const [busyId, setBusyId] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [edits, setEdits] = useState({});
  const [failure, setFailure] = useState(null);

  const categoryKeys = useMemo(() => Object.keys(CATEGORIES), []);

  const pendingTotal = useMemo(
    () => pending.reduce((sum, i) => sum + (Number(i.payload?.amount) || 0), 0),
    [pending],
  );

  const categoryFor = (item) => edits[item._docId] ?? item.payload?.category ?? '';

  const setCategory = (item, category) =>
    setEdits((prev) => ({ ...prev, [item._docId]: category }));

  const handleApprove = async (item) => {
    setBusyId(item._docId);
    setFailure(null);
    try {
      const category = categoryFor(item);
      await approve(item, category ? { category } : {});
    } catch (err) {
      setFailure(err?.message || String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (item) => {
    setBusyId(item._docId);
    setFailure(null);
    try {
      await reject(item);
    } catch (err) {
      setFailure(err?.message || String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleApproveAll = async () => {
    const ready = pending.filter((i) => categoryFor(i));
    if (!ready.length) return;
    setBulkBusy(true);
    setFailure(null);
    try {
      const res = await approveMany(
        ready.map((i) => ({ ...i, payload: { ...i.payload, category: categoryFor(i) } })),
      );
      if (res.failed.length) setFailure(`${res.failed.length} item(s) could not be approved.`);
    } finally {
      setBulkBusy(false);
    }
  };

  const readyCount = pending.filter((i) => categoryFor(i)).length;

  return (
    <div className={styles.page}>
      <Header
        title="Review"
        subtitle="Everything the automations weren't sure about"
      />

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
            {pending.length > 0 && (
              <span className={styles.total}>{formatEUR(pendingTotal)}</span>
            )}
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
              disabled={bulkBusy || readyCount === 0}
              title={readyCount === 0 ? 'Choose a category first' : undefined}
            >
              {bulkBusy ? <Loader2 size={15} className={styles.spin} /> : <Check size={15} />}
              Approve {readyCount} ready
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
              return (
                <li key={item._docId} className={styles.row}>
                  <div className={styles.rowMain}>
                    <div className={styles.rowTop}>
                      <span className={styles.name}>{p.name || 'Unnamed'}</span>
                      <span className={styles.amount}>{formatEUR(Number(p.amount) || 0)}</span>
                    </div>
                    <div className={styles.rowMeta}>
                      <span>{p.date || '—'}</span>
                      <span className={styles.sourceTag}>{SOURCE_LABELS[item.source] || item.source}</span>
                      {p.vatAmount != null && <span>VAT {formatEUR(Number(p.vatAmount))}</span>}
                      {item.evidence?.filename && <span>{item.evidence.filename}</span>}
                    </div>
                    {item.reasons?.length > 0 && (
                      <p className={styles.reason}>{item.reasons.join(' · ')}</p>
                    )}
                  </div>

                  <div className={styles.rowActions}>
                    <label className={styles.srOnly} htmlFor={`cat-${item._docId}`}>Category</label>
                    <select
                      id={`cat-${item._docId}`}
                      className={styles.select}
                      value={categoryFor(item)}
                      onChange={(e) => setCategory(item, e.target.value)}
                      disabled={busy}
                    >
                      <option value="">Choose a category…</option>
                      {categoryKeys.map((key) => (
                        <option key={key} value={key}>{CATEGORIES[key].label || key}</option>
                      ))}
                    </select>

                    <button
                      type="button"
                      className={styles.approve}
                      onClick={() => handleApprove(item)}
                      disabled={busy || !categoryFor(item)}
                      title={!categoryFor(item) ? 'Choose a category first' : 'Approve'}
                    >
                      {busy ? <Loader2 size={15} className={styles.spin} /> : <Check size={15} />}
                      Approve
                    </button>
                    <button
                      type="button"
                      className={styles.rejectBtn}
                      onClick={() => handleReject(item)}
                      disabled={busy}
                      title="Not a cost / ignore"
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
            <h2 className={styles.handledTitle}>Handled automatically</h2>
            <ul className={styles.handledList}>
              {recentlyHandled.slice(0, 12).map((item) => (
                <li key={item._docId} className={styles.handledRow}>
                  <span className={styles.handledName}>{item.payload?.name}</span>
                  <span className={styles.handledMeta}>
                    {SOURCE_LABELS[item.source] || item.source} · {item.status.replace('_', ' ')}
                  </span>
                  <span className={styles.handledAmount}>
                    {formatEUR(Number(item.payload?.amount) || 0)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
