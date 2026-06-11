import { useState, useMemo, useRef } from 'react';
import {
  Users, UserPlus, Mail, Send, Copy, Check, Clock, Bike, X, Search,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useMaintenance } from '../context/MaintenanceContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { authedFetch } from '../utils/apiClient.js';
import { useOrgCollection } from '../hooks/useOrgCollection.js';
import { orgUpdate } from '../hooks/orgWrite.js';
import styles from './Contractors.module.css';
import EmptyState from '../components/Shared/EmptyState.jsx';

/* ─── small helpers ─── */
function initialsOf(name = '', email = '') {
  const base = (name?.trim() || email?.split('@')[0] || 'U').trim();
  return (
    base.split(/\s+/).map((s) => Array.from(s)[0] || '').slice(0, 2).join('').toUpperCase() || 'U'
  );
}

const AVATAR_COLORS = ['#15803D', '#2563EB', '#A0521D', '#7C3AED', '#0891B2', '#DB2777'];
function colorFor(key = '') {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function Avatar({ name, email, size = 32 }) {
  return (
    <div
      className={styles.avatar}
      style={{ width: size, height: size, background: colorFor(name || email), fontSize: size * 0.4 }}
    >
      {initialsOf(name, email)}
    </div>
  );
}

function relTime(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
    if (!d || Number.isNaN(d.getTime())) return '';
    const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
    if (days <= 0) return 'today';
    if (days === 1) return '1 day ago';
    return `${days} days ago`;
  } catch {
    return '';
  }
}

/* ─── assign-scooters modal ─── */
function AssignModal({ contractor, scooters, onClose, onSave }) {
  const [sel, setSel] = useState(() => new Set((contractor.assignedScooterIds ?? []).map(String)));
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return scooters
      .filter(
        (s) =>
          !term ||
          String(s.scooterId).toLowerCase().includes(term) ||
          String(s.city ?? '').toLowerCase().includes(term),
      )
      .sort((a, b) => String(a.scooterId).localeCompare(String(b.scooterId), undefined, { numeric: true }));
  }, [scooters, search]);

  function toggle(id) {
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function save() {
    setBusy(true);
    await onSave([...sel]);
    setBusy(false);
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className={styles.modalHead}>
          <div>
            <div className={styles.eyebrow}>Assign scooters</div>
            <div className={styles.modalTitle}>{contractor.displayName || contractor.email}</div>
          </div>
          <button className={styles.iconBtn} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <p className={styles.modalDesc}>
          The contractor only sees tickets for the scooters you assign here — never the rest of your fleet
          or business data.
        </p>

        <div className={styles.searchWrap}>
          <Search size={15} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            placeholder="Search by scooter ID or city…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className={styles.scooterList}>
          {filtered.length === 0 ? (
            <div className={styles.modalEmpty}>No scooters match “{search}”.</div>
          ) : (
            filtered.map((s) => {
              const id = String(s.scooterId);
              const checked = sel.has(id);
              return (
                <label key={s._docId ?? id} className={`${styles.scooterRow} ${checked ? styles.scooterRowOn : ''}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(id)} />
                  <Bike size={15} className={styles.scooterIcon} />
                  <span className={styles.scooterId}>#{id}</span>
                  <span className={styles.scooterMeta}>
                    {s.city || '—'}
                    {s.status ? ` · ${s.status}` : ''}
                  </span>
                </label>
              );
            })
          )}
        </div>

        <div className={styles.modalFoot}>
          <span className={styles.count}>{sel.size} selected</span>
          <div className={styles.modalFootBtns}>
            <button className={styles.btnGhost} onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className={styles.btnPrimary} onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save assignment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── page ─── */
export default function Contractors() {
  const { userProfile } = useAuth();
  const isAdmin = userProfile?.role === 'admin' || userProfile?.role === 'owner';
  const maintenanceCtx = useMaintenance();
  const scooters = maintenanceCtx?.scooters ?? [];
  const tickets = maintenanceCtx?.tickets ?? [];
  const { success: toastSuccess, error: toastError } = useToast();

  /* Roster — org-scoped users; filter to role==='contractor' in JS (ADR-0023: data
     lives in jsonb, not a column — no server-side where on role) */
  const { items: allUsers, loading: usersLoading } = useOrgCollection('users', {});
  const contractors = useMemo(
    () => allUsers.filter((u) => u.role === 'contractor'),
    [allUsers],
  );

  /* Pending invites — org-scoped; filter status==='pending' + role==='contractor' in JS */
  const { items: allInvites, loading: invitesLoading } = useOrgCollection('invites', {});
  const invites = useMemo(
    () => allInvites.filter((i) => i.status === 'pending' && i.role === 'contractor'),
    [allInvites],
  );

  const loading = usersLoading || invitesLoading;

  const emailRef = useRef(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [copied, setCopied] = useState(false);

  const [assignFor, setAssignFor] = useState(null);

  const scooterById = useMemo(() => {
    const m = new Map();
    for (const s of scooters) m.set(String(s.scooterId), s);
    return m;
  }, [scooters]);

  const jobsFor = (uid) => tickets.filter((t) => t.assignedTo === uid && t.status !== 'Completed').length;

  const assignedLabel = (ids = []) => {
    const n = ids.length;
    if (!n) return 'No scooters assigned';
    const cities = [...new Set(ids.map((id) => scooterById.get(String(id))?.city).filter(Boolean))];
    const cityPart = cities.length === 1 ? ` · ${cities[0]}` : cities.length > 1 ? ` · ${cities.length} cities` : '';
    return `${n} scooter${n > 1 ? 's' : ''}${cityPart}`;
  };

  const focusInvite = () => {
    emailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    emailRef.current?.focus();
  };

  async function handleInvite() {
    const email = inviteEmail.trim();
    if (!email) return;
    setInviteBusy(true);
    setInviteLink('');
    setCopied(false);
    try {
      const res = await authedFetch('/api/create-invite', {
        method: 'POST',
        body: JSON.stringify({ email, role: 'contractor' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not create the invite.');
      setInviteLink(data.link || '');
      setInviteEmail('');
      toastSuccess(
        data.emailed
          ? `Invite emailed to ${email}.`
          : `Invite link created for ${email} — copy and share it below.`,
      );
    } catch (err) {
      toastError(err.message || 'Could not create the invite.');
    } finally {
      setInviteBusy(false);
    }
  }

  async function copyLink() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toastError('Could not copy — select the link and copy it manually.');
    }
  }

  async function saveAssignment(uid, ids) {
    const res = await orgUpdate('users', uid, { assignedScooterIds: ids }, {
      errorMessage: 'Failed to save scooter assignment.',
    });
    if (res?.ok !== false) {
      toastSuccess('Scooter assignment saved.');
      setAssignFor(null);
    }
  }

  const isEmpty = !loading && contractors.length === 0 && invites.length === 0;

  return (
    <div className={styles.page}>
      {/* header */}
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Maintenance · Crew</div>
          <h1 className={styles.title}>Contractors</h1>
        </div>
        <div className={styles.headerActions}>
          {isAdmin && (
            <button className={styles.inviteBtn} onClick={focusInvite}>
              <UserPlus size={15} />
              Invite contractor
            </button>
          )}
        </div>
      </div>

      <div className={styles.grid}>
        {/* roster */}
        <div className={styles.card}>
          <div className={styles.tableHead}>
            <span>Contractor</span>
            <span>Status</span>
            <span>Assigned work</span>
            <span className={styles.right}>Jobs</span>
          </div>

          {loading ? (
            <div className={styles.empty}>Loading contractors…</div>
          ) : isEmpty ? (
            <EmptyState
              icon={Users}
              title="No contractors yet"
              description="Invite your first contractor — they get a link to set their own password and only ever see the scooters you assign."
            />
          ) : (
            <>
              {contractors.map((c) => (
                <div key={c._docId} className={styles.row}>
                  <div className={styles.cellContractor}>
                    <Avatar name={c.displayName} email={c.email} />
                    <div className={styles.cMeta}>
                      <span className={styles.cName}>{c.displayName || c.email?.split('@')[0]}</span>
                      <span className={styles.cEmail}>{c.email}</span>
                    </div>
                  </div>
                  <div>
                    <span className={`${styles.pill} ${styles.pillGreen}`}>
                      <Check size={11} />
                      Active
                    </span>
                  </div>
                  <div className={styles.assignedWork}>
                    <span className={styles.assignedText}>{assignedLabel(c.assignedScooterIds)}</span>
                    {isAdmin && (
                      <button className={styles.assignBtn} onClick={() => setAssignFor(c)}>
                        Assign
                      </button>
                    )}
                  </div>
                  <div className={`${styles.right} ${styles.jobs}`}>{jobsFor(c._docId) || '—'}</div>
                </div>
              ))}

              {invites.map((inv) => (
                <div key={inv._docId} className={styles.row}>
                  <div className={styles.cellContractor}>
                    <Avatar email={inv.email} />
                    <div className={styles.cMeta}>
                      <span className={styles.cName}>{inv.email}</span>
                      <span className={styles.cEmail}>Invitation pending</span>
                    </div>
                  </div>
                  <div>
                    <span className={`${styles.pill} ${styles.pillAmber}`}>
                      <Clock size={11} />
                      Invited
                    </span>
                  </div>
                  <div className={styles.assignedWork}>
                    <span className={styles.assignedMuted}>
                      Invite sent {relTime(inv.createdAt)}
                    </span>
                  </div>
                  <div className={`${styles.right} ${styles.jobsMuted}`}>—</div>
                </div>
              ))}
            </>
          )}
        </div>

        {/* invite panel */}
        {isAdmin ? (
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <Users size={17} className={styles.panelIcon} />
              <span className={styles.panelTitle}>Invite a contractor</span>
            </div>
            <p className={styles.panelDesc}>
              They&rsquo;ll get a link to set their own password and join your fleet. They only ever see the
              work you assign — never your business data.
            </p>

            <div className={styles.label}>Email address</div>
            <div className={styles.inputWrap}>
              <Mail size={15} className={styles.inputIcon} />
              <input
                ref={emailRef}
                type="email"
                className={styles.input}
                placeholder="name@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleInvite();
                }}
              />
            </div>

            <button className={styles.sendBtn} onClick={handleInvite} disabled={inviteBusy || !inviteEmail.trim()}>
              <Send size={15} />
              {inviteBusy ? 'Creating…' : 'Send invite'}
            </button>

            {inviteLink && (
              <>
                <div className={styles.label} style={{ marginTop: 14 }}>
                  Share this link
                </div>
                <div className={styles.linkRow}>
                  <span className={styles.linkText}>{inviteLink}</span>
                  <button className={styles.copyBtn} onClick={copyLink}>
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className={styles.hint}>The link expires in 7 days and can be used once.</p>
              </>
            )}
          </div>
        ) : (
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <Users size={17} className={styles.panelIcon} />
              <span className={styles.panelTitle}>Contractors</span>
            </div>
            <p className={styles.panelDesc}>
              Only admins and the org owner can invite contractors or change scooter assignments.
            </p>
          </div>
        )}
      </div>

      {assignFor && (
        <AssignModal
          contractor={assignFor}
          scooters={scooters}
          onClose={() => setAssignFor(null)}
          onSave={(ids) => saveAssignment(assignFor._docId, ids)}
        />
      )}
    </div>
  );
}
