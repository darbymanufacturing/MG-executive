import { useState, useEffect, useCallback, useRef } from 'react';
import { Link2, RefreshCw, Unlink, AlertCircle, CheckCircle2 } from 'lucide-react';
import { doc, writeBatch, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';
import { mapTransactionToCost } from '../../utils/bankTransactionMapper.js';
import { authedFetch } from '../../utils/apiClient.js';
import { useOrg } from '../../context/OrgContext.jsx';
import { orgDocId } from '../../utils/orgDocId.js';
import Button from '../Shared/Button.jsx';
import styles from './BankConnect.module.css';

const BANK_TX_COL = 'bankTransactions';
const BATCH_SIZE  = 450;

// ── helpers ───────────────────────────────────────────────────────────────────

async function writeTransactions(rawTxs, orgId) {
  // Only import debits (negative amount from Salt Edge)
  const debits = rawTxs.filter((tx) => (tx.amount ?? 0) < 0 && tx.id);
  if (debits.length === 0) return 0;

  // #166: Salt Edge returns deterministic transaction IDs and batch.set is idempotent —
  // no need to fetch existing IDs for dedup. setDoc with same data is a no-op.
  // #397: stamp orgId + use org-scoped doc IDs to prevent cross-tenant data leaks.
  for (let i = 0; i < debits.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    debits.slice(i, i + BATCH_SIZE).forEach((tx) => {
      // #211: sanitize Salt Edge tx.id to remove Firestore-invalid path characters
      const safeId = String(tx.id).replace(/[/.#$[\]]/g, '_');
      const scopedId = orgId ? orgDocId(orgId, safeId) : safeId;
      const mapped = mapTransactionToCost(tx);
      batch.set(doc(db, BANK_TX_COL, scopedId), {
        ...tx,
        ...mapped,
        orgId:    orgId ?? null,
        status:   'pending',
        stagedAt: new Date().toISOString(),
      });
    });
    await batch.commit();
  }
  return debits.length;
}

async function pollForConnection(customerId, maxAttempts = 6, intervalMs = 3000) {
  for (let i = 0; i < maxAttempts; i++) {
    const res  = await authedFetch(`/api/bank-connections?customer_id=${customerId}`);
    const data = await res.json();
    const active = (data.connections || []).find((c) => c.status === 'active');
    if (active) return active.id;
    if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

// ── component ──────────────────────────────────────────────────────────────────

export default function BankConnect({ onNewTransactions }) {
  const { orgId } = useOrg();
  const [status,       setStatus]       = useState('idle'); // idle | connecting | polling | syncing | done | error
  const [message,      setMessage]      = useState('');
  const [connectionId, setConnectionId] = useState(() => localStorage.getItem('se_connection_id') || '');
  const [customerId,   setCustomerId]   = useState(() => localStorage.getItem('se_customer_id')   || '');

  // #167: prevent state updates after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Detect return from Salt Edge (sessionStorage flag set before redirect) ───
  useEffect(() => {
    if (!sessionStorage.getItem('se_connecting')) return;
    const storedCustomerId = localStorage.getItem('se_customer_id');
    if (!storedCustomerId) return;

    sessionStorage.removeItem('se_connecting');
    setStatus('polling');
    setMessage('Waiting for bank connection to activate…');

    pollForConnection(storedCustomerId).then(async (connId) => {
      if (!mountedRef.current) return; // #167: guard against unmount
      if (!connId) {
        setStatus('error');
        setMessage('Connection not found. Please try connecting again.');
        return;
      }
      localStorage.setItem('se_connection_id', connId);
      setConnectionId(connId);
      // #399: use org-scoped config doc id instead of global 'config/bank' singleton
      const bankCfgDocId = orgId ? orgDocId(orgId, 'bank') : 'bank';
      await setDoc(doc(db, 'config', bankCfgDocId), {
        connectionId: connId, customerId: storedCustomerId, connectedAt: new Date().toISOString(),
        orgId: orgId ?? null,
      });
      if (!mountedRef.current) return; // #167: guard after async setDoc
      await fetchTransactions(connId);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchTransactions = useCallback(async (connId) => {
    setStatus('syncing');
    setMessage('Fetching transactions…');
    try {
      const res  = await authedFetch('/api/bank-transactions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ connection_id: connId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unknown error');

      const count = await writeTransactions(data.transactions || [], orgId);
      setStatus('done');
      setMessage(`${count} new transaction${count !== 1 ? 's' : ''} staged for review.`);
      onNewTransactions?.(count);
    } catch (err) {
      setStatus('error');
      setMessage(err.message);
    }
  }, [onNewTransactions, orgId]);

  const handleConnect = async () => {
    setStatus('connecting');
    setMessage('Creating bank session…');
    try {
      const redirectUrl = `${window.location.origin}/settings`;
      const res  = await authedFetch('/api/bank-session', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ customer_id: customerId || undefined, redirect_url: redirectUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unknown error');

      // Persist customer_id and set redirect flag before leaving
      localStorage.setItem('se_customer_id', data.customer_id);
      setCustomerId(data.customer_id);
      sessionStorage.setItem('se_connecting', '1');

      window.location.href = data.connect_url;
    } catch (err) {
      setStatus('error');
      setMessage(err.message);
    }
  };

  const handleSync = async () => {
    if (!connectionId) return;
    setStatus('syncing');
    setMessage('Syncing latest transactions…');
    try {
      const res  = await authedFetch('/api/bank-refresh', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ connection_id: connectionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unknown error');

      const count = await writeTransactions(data.transactions || [], orgId);
      setStatus('done');
      setMessage(`${count} new transaction${count !== 1 ? 's' : ''} staged.`);
      onNewTransactions?.(count);
    } catch (err) {
      setStatus('error');
      setMessage(err.message);
    }
  };

  const handleDisconnect = () => {
    localStorage.removeItem('se_connection_id');
    localStorage.removeItem('se_customer_id');
    setConnectionId('');
    setCustomerId('');
    setStatus('idle');
    setMessage('');
  };

  const isConnected = !!connectionId;
  const busy        = status === 'connecting' || status === 'polling' || status === 'syncing';

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <Link2 size={16} className={styles.cardIcon} />
        <span>Bank Connection</span>
        {isConnected && (
          <span className={styles.connectedBadge}>
            <CheckCircle2 size={12} /> Connected
          </span>
        )}
      </div>

      <p className={styles.cardDesc}>
        Connect your Greek bank account (Alpha Bank, Eurobank, NBG) via Salt Edge to automatically
        pull the last 90 days of outgoing transactions as draft cost entries.
      </p>

      <div className={styles.actions}>
        {!isConnected ? (
          <Button variant="primary" size="sm" onClick={handleConnect} disabled={busy}>
            <Link2 size={14} /> {busy ? 'Connecting…' : 'Connect Bank'}
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
        <div className={`${styles.msg} ${
          status === 'error'   ? styles.msgError   :
          status === 'done'    ? styles.msgSuccess  :
          styles.msgInfo
        }`}>
          {status === 'error' && <AlertCircle  size={13} />}
          {status === 'done'  && <CheckCircle2 size={13} />}
          {message}
        </div>
      )}

      <p className={styles.hint}>
        Powered by <strong>Salt Edge</strong> (PSD2/open banking). Only outgoing payments are
        imported. Your credentials are never stored in the browser.
      </p>
    </div>
  );
}
