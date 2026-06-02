import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, ArrowUpRight } from 'lucide-react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useOrgCollection } from '../../hooks/useOrgCollection.js';
import { ownerBalance } from '../../utils/ownerLedger.js';
import { formatEUR } from '../../utils/formatters.js';
import styles from './OwnerBalancesWidget.module.css';

/* FF-1 — Dashboard widget: each owner's current-account balance + the company net.
   Renders nothing until owners are designated (no clutter for orgs without owners). */
const AVATAR_COLORS = ['#15803D', '#2563EB', '#A0521D', '#7C3AED', '#0891B2', '#DB2777'];
function colorFor(key = '') {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initialsOf(name = '') {
  return (name.trim().split(/\s+/).map((s) => Array.from(s)[0] || '').slice(0, 2).join('') || '?').toUpperCase();
}

export default function OwnerBalancesWidget() {
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  const orgId = userProfile?.orgId ?? null;
  const { items: entries } = useOrgCollection('ownerLedger', { limit: 1000 });
  const [owners, setOwners] = useState([]);

  useEffect(() => {
    if (!orgId) return undefined;
    const q = query(collection(db, 'users'), where('orgId', '==', orgId));
    const unsub = onSnapshot(
      q,
      (snap) => setOwners(
        snap.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((u) => u.isOwner || u.role === 'owner'),
      ),
      (err) => console.error('Owner-balances widget users listener error:', err),
    );
    return unsub;
  }, [orgId]);

  const rows = useMemo(() => owners.map((o) => ({ o, bal: ownerBalance(entries, o.uid) })), [owners, entries]);
  const net = useMemo(() => rows.reduce((s, r) => s + r.bal, 0), [rows]);

  if (owners.length === 0) return null;

  return (
    <div className={`card ${styles.widget}`}>
      <button className={styles.head} onClick={() => navigate('/owner-ledger')} title="Open Owner Ledger">
        <Wallet size={16} className={styles.headIcon} />
        <span className={styles.title}>Owner balances</span>
        <ArrowUpRight size={15} className={styles.openIcon} />
      </button>

      <div className={styles.rows}>
        {rows.map(({ o, bal }) => {
          const pos = bal >= 0;
          const name = o.displayName || o.email?.split('@')[0] || 'Owner';
          return (
            <div key={o.uid} className={styles.row}>
              <div className={styles.avatar} style={{ background: colorFor(name) }}>{initialsOf(name)}</div>
              <div className={styles.meta}>
                <span className={styles.name}>{name}</span>
                <span className={styles.sub}>{bal === 0 ? 'Settled up' : pos ? 'Company owes' : 'Owes company'}</span>
              </div>
              <span
                className={styles.bal}
                style={{ color: bal === 0 ? 'var(--fg-muted)' : pos ? 'var(--status-green)' : 'var(--status-red)' }}
              >
                {bal === 0 ? '€0' : `${pos ? '+' : '−'}${formatEUR(Math.abs(bal))}`}
              </span>
            </div>
          );
        })}
      </div>

      <div className={styles.netRow}>
        <span className={styles.netLabel}>Company net</span>
        <span className={styles.netVal} style={{ color: net >= 0 ? 'var(--status-green)' : 'var(--status-red)' }}>
          {net === 0 ? '€0' : `${net >= 0 ? '+' : '−'}${formatEUR(Math.abs(net))}`}
          <span className={styles.netSub}>{net >= 0 ? 'owed to owners' : 'owed by owners'}</span>
        </span>
      </div>
    </div>
  );
}
