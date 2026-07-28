import { useState, useMemo } from 'react';
import { Plus, X, Trash2, UserCheck, Building2, Scale, ChevronDown, ChevronUp } from 'lucide-react';
import Header from '../components/Layout/Header.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useOrgCollection } from '../hooks/useOrgCollection.js';
import { orgWrite, orgDelete, orgUpdate } from '../hooks/orgWrite.js';
import { useToast } from '../context/ToastContext.jsx';
import { formatEUR, todayISO } from '../utils/formatters.js';
import { LEDGER_ENTRY_TYPES, LEDGER_TYPE_KEYS, signedAmount, ownerBalance } from '../utils/ownerLedger.js';
import EmptyState from '../components/Shared/EmptyState.jsx';
import styles from './OwnerLedger.module.css';

function nameOf(users, uid, fallback) {
  const u = users.find((x) => x._docId === uid);
  return u?.displayName || u?.email?.split('@')[0] || fallback || 'Owner';
}

/* ── add-entry modal ── */
function EntryModal({ owners, onClose, onSave }) {
  const [form, setForm] = useState({
    ownerUid: owners[0]?._docId ?? '',
    type: 'salary_accrual',
    amount: '',
    direction: 1,
    date: todayISO(),
    note: '',
  });
  const [busy, setBusy] = useState(false);
  const def = LEDGER_ENTRY_TYPES[form.type];
  const valid = form.ownerUid && form.amount && Number(form.amount) > 0 && form.date;

  async function save() {
    if (!valid) return;
    setBusy(true);
    await onSave({
      ownerUid: form.ownerUid,
      ownerName: owners.find((o) => o._docId === form.ownerUid)?.displayName ?? null,
      type: form.type,
      amount: Number(form.amount),
      direction: def?.directional ? Number(form.direction) : null,
      date: form.date,
      note: form.note.trim(),
    });
    setBusy(false);
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className={styles.modalHead}>
          <span className={styles.modalTitle}>Add ledger entry</span>
          <button className={styles.iconBtn} onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <label className={styles.field}>
          <span className={styles.label}>Owner</span>
          <select className={styles.input} value={form.ownerUid} onChange={(e) => setForm((f) => ({ ...f, ownerUid: e.target.value }))}>
            {owners.map((o) => (
              <option key={o._docId} value={o._docId}>{o.displayName || o.email}</option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Type</span>
          <select className={styles.input} value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
            {LEDGER_TYPE_KEYS.map((k) => (
              <option key={k} value={k}>{LEDGER_ENTRY_TYPES[k].label}</option>
            ))}
          </select>
          {def?.hint && <span className={styles.hint}>{def.hint}</span>}
        </label>

        {def?.directional && (
          <label className={styles.field}>
            <span className={styles.label}>Direction</span>
            <select className={styles.input} value={form.direction} onChange={(e) => setForm((f) => ({ ...f, direction: Number(e.target.value) }))}>
              <option value={1}>Company pays you (+)</option>
              <option value={-1}>You pay the company (−)</option>
            </select>
          </label>
        )}

        <div className={styles.modalRow}>
          <label className={styles.field}>
            <span className={styles.label}>Amount (€)</span>
            <input type="number" min="0" step="0.01" inputMode="decimal" className={styles.input} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Date</span>
            <input type="date" className={styles.input} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          </label>
        </div>

        <label className={styles.field}>
          <span className={styles.label}>Note (optional)</span>
          <input className={styles.input} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="e.g. June salary" />
        </label>

        <div className={styles.modalFoot}>
          <button className={styles.ghostBtn} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={styles.primaryBtn} onClick={save} disabled={!valid || busy}>{busy ? 'Saving…' : 'Add entry'}</button>
        </div>
      </div>
    </div>
  );
}

export default function OwnerLedger() {
  const { userProfile } = useAuth();
  const isAdmin = userProfile?.role === 'admin' || userProfile?.role === 'owner';
  const { items: entries, loading } = useOrgCollection('ownerLedger', { limit: 1000 });
  const { items: users } = useOrgCollection('users', {});
  const { success: toastSuccess, error: toastError } = useToast();

  const [showAdd, setShowAdd] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const owners = useMemo(() => users.filter((u) => u.isOwner || u.role === 'owner'), [users]);

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? ''))),
    [entries],
  );

  async function handleAdd(data) {
    try {
      await orgWrite('ownerLedger', data, { rethrow: true, errorMessage: 'Failed to add ledger entry' });
      toastSuccess('Ledger entry added.');
      setShowAdd(false);
    } catch (err) {
      toastError(err.message || 'Could not add the entry.');
    }
  }

  async function handleDelete(e) {
    try {
      await orgDelete('ownerLedger', e._docId, { rethrow: true, errorMessage: 'Failed to delete entry' });
      toastSuccess('Entry removed.');
    } catch (err) {
      toastError(err.message || 'Could not remove the entry.');
    }
  }

  async function toggleOwner(u) {
    const newIsOwner = !(u.isOwner || u.role === 'owner');
    const res = await orgUpdate('users', u._docId, { isOwner: newIsOwner });
    if (res?.ok !== false) toastSuccess(u.isOwner ? `${nameOf(users, u._docId)} is no longer an owner.` : `${nameOf(users, u._docId)} marked as owner.`);
  }

  return (
    <div className={styles.page}>
      <Header
        title="Owner Ledger"
        subtitle="What the company owes each owner — or what they owe it"
        actions={
          isAdmin && owners.length > 0 ? (
            <button className={styles.addBtn} onClick={() => setShowAdd(true)}>
              <Plus size={15} /> Add entry
            </button>
          ) : null
        }
      />

      <div className={styles.content}>
        <div className={styles.companyWide}>
          <Building2 size={14} /> Company-wide — not affected by the fleet switcher.
        </div>

        {/* Owner setup prompt */}
        {owners.length === 0 ? (
          <EmptyState
            icon={Scale}
            title="No owners designated yet"
            description="Mark the company’s owners below to start tracking each one’s current account (salary accrued vs paid, money put in, money taken out)."
          />
        ) : (
          <>
            {/* Per-owner balance cards */}
            <div className={styles.balanceGrid}>
              {owners.map((o) => {
                const bal = ownerBalance(entries, o._docId);
                const owedToYou = bal >= 0;
                return (
                  <div key={o._docId} className={styles.balanceCard}>
                    <span className={styles.ownerName}>{o.displayName || o.email}</span>
                    <span
                      className={styles.balanceVal}
                      style={{ color: bal === 0 ? 'var(--fg-muted)' : owedToYou ? 'var(--status-green)' : 'var(--status-red)' }}
                    >
                      {bal === 0 ? '€0' : `${owedToYou ? '+' : '−'}${formatEUR(Math.abs(bal))}`}
                    </span>
                    <span className={styles.balanceLabel}>
                      {bal === 0 ? 'Settled up' : owedToYou ? 'Company owes them' : 'They owe the company'}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Entries */}
            <div className={styles.card}>
              <div className={styles.tHead}>
                <span>Date</span><span>Owner</span><span>Type</span><span className={styles.right}>Amount</span><span />
              </div>
              {loading ? (
                <div className={styles.rowEmpty}>Loading entries…</div>
              ) : sortedEntries.length === 0 ? (
                <div className={styles.rowEmpty}>No entries yet — add the first with “Add entry”.</div>
              ) : (
                sortedEntries.map((e) => {
                  const signed = signedAmount(e);
                  const pos = signed >= 0;
                  return (
                    <div key={e._docId} className={styles.row}>
                      <span className={styles.date}>{e.date || '—'}</span>
                      <span className={styles.owner}>{e.ownerName || nameOf(users, e.ownerUid)}</span>
                      <span className={styles.type}>
                        {LEDGER_ENTRY_TYPES[e.type]?.label ?? e.type}
                        {e.note && <span className={styles.note}>{e.note}</span>}
                      </span>
                      <span className={`${styles.right} ${styles.amount}`} style={{ color: pos ? 'var(--status-green)' : 'var(--status-red)' }}>
                        {pos ? '+' : '−'}{formatEUR(Math.abs(signed))}
                      </span>
                      <span className={styles.right}>
                        {isAdmin && (
                          <button className={styles.delBtn} onClick={() => handleDelete(e)} aria-label="Delete entry"><Trash2 size={13} /></button>
                        )}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* Owner designation */}
        {isAdmin && (
          <div className={styles.manage}>
            <button className={styles.manageToggle} onClick={() => setManageOpen((v) => !v)}>
              <UserCheck size={15} /> Designate owners
              {manageOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            {manageOpen && (
              <div className={styles.manageBody}>
                <p className={styles.manageHint}>An owner gets their own current-account balance. (Admins aren&rsquo;t owners unless flagged here.)</p>
                {users.length === 0 ? (
                  <div className={styles.rowEmpty}>No team members found.</div>
                ) : (
                  users.map((u) => {
                    const isOwn = u.isOwner || u.role === 'owner';
                    return (
                      <label key={u._docId} className={styles.ownerToggleRow}>
                        <input type="checkbox" checked={isOwn} onChange={() => toggleOwner(u)} />
                        <span className={styles.toggleName}>{u.displayName || u.email}</span>
                        <span className={styles.toggleRole}>{u.role ?? '—'}</span>
                      </label>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {showAdd && owners.length > 0 && (
        <EntryModal owners={owners} onClose={() => setShowAdd(false)} onSave={handleAdd} />
      )}
    </div>
  );
}
