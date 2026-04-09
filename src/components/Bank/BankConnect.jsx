import { useState, useEffect, useCallback } from 'react';
import { Link2, RefreshCw, Unlink, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  collection, doc, writeBatch, getDocs, setDoc,
} from 'firebase/firestore';
import { db } from '../../lib/firebase.js';
import { mapTransactionToCost } from '../../utils/bankTransactionMapper.js';
import Button from '../Shared/Button.jsx';
import styles from './BankConnect.module.css';

const BANK_TX_COL   = 'bankTransactions';
const BANK_CFG_DOC  = 'config/bank';
const BATCH_SIZE    = 450;

// ── helpers ──────────────────────────────────────────────────────────────────

async function writeTransactions(rawTxs) {
  // Only import debits (negative amount) — outgoing payments
  const debits = rawTxs.filter((tx) => parseFloat(tx.transactionAmount?.amount ?? '0') < 0);
  if (debits.length === 0) return 0;

  // Get existing transactionIds to skip duplicates
  const existingSnap = await getDocs(collection(db, BANK_TX_COL));
  const existingIds  = new Set(existingSnap.docs.map((d) => d.id));

  const newTxs = debits.filter((tx) => tx.transactionId && !existingIds.has(tx.transactionId));
  if (newTxs.length === 0) return 0;

  for (let i = 0; i < newTxs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    newTxs.slice(i, i + BATCH_SIZE).forEach((tx) => {
      const mapped = mapTransactionToCost(tx);
      batch.set(doc(db, BANK_TX_COL, tx.transactionId), {
        ...tx,
        ...mapped,
        status: 'pending',
        stagedAt: new Date().toISOString(),
      });
    });
    await batch.commit();
  }
  return newTxs.length;
}

// ── component ─────────────────────────────────────────────────────────────────

export default function BankConnect({ onNewTransactions }) {
  const [status,     setStatus]     = useState('idle'); // idle | connecting | syncing | done | error
  const [message,    setMessage]    = useState('');
  const [accountIds, setAccountIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('gc_account_ids') || '[]'); } catch { return []; }
  });
  const [reqId, setReqId] = useState(() => localStorage.getItem('gc_requisition_id') || '');

  // ── Detect redirect back from GoCardless (?ref=requisition_id) ─────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (!ref) return;

    // Clean the URL without reload
    window.history.replaceState({}, '', window.location.pathname);

    setReqId(ref);
    localStorage.setItem('gc_requisition_id', ref);
    fetchAfterAuth(ref);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAfterAuth = useCallback(async (requisitionId) => {
    setStatus('syncing');
    setMessage('Fetching transactions from Alpha Bank…');
    try {
      const res  = await fetch('/api/bank-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requisition_id: requisitionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unknown error');

      // Persist account IDs for future syncs
      const ids = data.account_ids || [];
      setAccountIds(ids);
      localStorage.setItem('gc_account_ids', JSON.stringify(ids));
      await setDoc(doc(db, BANK_CFG_DOC), { accountIds: ids, connectedAt: new Date().toISOString() });

      const count = await writeTransactions(data.transactions || []);
      setStatus('done');
      setMessage(`${count} new transaction${count !== 1 ? 's' : ''} staged for review.`);
      onNewTransactions?.(count);
    } catch (err) {
      setStatus('error');
      setMessage(err.message);
    }
  }, [onNewTransactions]);

  const handleConnect = async () => {
    setStatus('connecting');
    setMessage('Creating bank session…');
    try {
      const redirectUrl = `${window.location.origin}/settings`;
      const res  = await fetch('/api/bank-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirect_url: redirectUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unknown error');

      // Open the GoCardless auth page in the same tab (bank PSD2 may block popups)
      window.location.href = data.link;
    } catch (err) {
      setStatus('error');
      setMessage(err.message);
    }
  };

  const handleSync = async () => {
    if (accountIds.length === 0) return;
    setStatus('syncing');
    setMessage('Syncing latest transactions…');
    try {
      let totalNew = 0;
      for (const accountId of accountIds) {
        const res  = await fetch('/api/bank-refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_id: accountId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Unknown error');
        totalNew += await writeTransactions(data.transactions || []);
      }
      setStatus('done');
      setMessage(`${totalNew} new transaction${totalNew !== 1 ? 's' : ''} staged.`);
      onNewTransactions?.(totalNew);
    } catch (err) {
      setStatus('error');
      setMessage(err.message);
    }
  };

  const handleDisconnect = () => {
    localStorage.removeItem('gc_requisition_id');
    localStorage.removeItem('gc_account_ids');
    setReqId('');
    setAccountIds([]);
    setStatus('idle');
    setMessage('');
  };

  const isConnected = accountIds.length > 0;
  const busy        = status === 'connecting' || status === 'syncing';

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <Link2 size={16} className={styles.cardIcon} />
        <span>Alpha Bank Connection</span>
        {isConnected && <span className={styles.connectedBadge}><CheckCircle2 size={12} /> Connected</span>}
      </div>

      <p className={styles.cardDesc}>
        Connect your Alpha Bank account via GoCardless to automatically pull the last 90 days of
        outgoing transactions as draft cost entries.
      </p>

      <div className={styles.actions}>
        {!isConnected ? (
          <Button variant="primary" size="sm" onClick={handleConnect} disabled={busy}>
            <Link2 size={14} /> {busy ? 'Connecting…' : 'Connect Alpha Bank'}
          </Button>
        ) : (
          <>
            <Button variant="primary" size="sm" onClick={handleSync} disabled={busy}>
              <RefreshCw size={14} className={busy ? styles.spin : ''} />
              {busy ? 'Syncing…' : 'Sync Now'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={busy}>
              <Unlink size={14} /> Disconnect
            </Button>
          </>
        )}
      </div>

      {message && (
        <div className={`${styles.msg} ${status === 'error' ? styles.msgError : status === 'done' ? styles.msgSuccess : styles.msgInfo}`}>
          {status === 'error' && <AlertCircle size={13} />}
          {status === 'done'  && <CheckCircle2 size={13} />}
          {message}
        </div>
      )}

      <p className={styles.hint}>
        Powered by <strong>GoCardless Bank Account Data</strong> (free, PSD2/open banking).
        Only outgoing payments are imported. Your credentials are never stored in the browser.
      </p>
    </div>
  );
}
