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

// ── localStorage key helpers (org-scoped, fix #511) ──────────────────────────

/** Org-scoped localStorage key helpers (fix #511: global keys caused cross-tenant leaks) */
function lsKey(base, orgId) {
  return orgId ? `${base}_${orgId}` : base;
}
function lsGet(base, orgId) {
  return localStorage.getItem(lsKey(base, orgId)) || '';
}
function lsSet(base, orgId, value) {
  localStorage.setItem(lsKey(base, orgId), value);
}
function lsRemove(base, orgId) {
  localStorage.removeItem(lsKey(base, orgId));
}

// ── component ──────────────────────────────────────────────────────────────────

export default function BankConnect({ onNewTransactions }) {
  const { orgId } = useOrg();
  const [status,       setStatus]       = useState('idle'); // idle | connecting | polling | syncing | done | error
  const [message,      setMessage]      = useState('');
  // #511: do NOT use lazy initializers here — orgId is not yet known at that point.
  // Instead, seed from localStorage in a useEffect keyed on orgId (see below).
  const [connectionId, setConnectionId] = useState('');
  const [customerId,   setCustomerId]   = useState('');

  // #167: prevent state updates after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // #511: load org-scoped localStorage values whenever orgId becomes known or changes.
  // Also clear local state when the org changes so the prior org's connection is never shown.
  useEffect(() => {
    if (!orgId) return;
    setConnectionId(lsGet('se_connection_id', orgId));
    setCustomerId(lsGet('se_customer_id',   orgId));
    setStatus('idle');
    setMessage('');
  }, [orgId]);

  // ── Detect return from Salt Edge (sessionStorage flag set before redirect) ───
  // #535: orgId is stable across re-renders once set, but the flag and key reads
  //        must use the current (post-return) orgId, so include it in deps.
  //        Add .catch() so a pollForConnection failure is surfaced to the user.
  useEffect(() => {
    if (!orgId) return; // #535: wait until orgId is known before processing return
    if (!sessionStorage.getItem('se_connecting')) return;
    // #511: read the org-scoped customer_id key
    const storedCustomerId = lsGet('se_customer_id', orgId);
    if (!storedCustomerId) return;

    sessionStorage.removeItem('se_connecting');
    setStatus('polling');
    setMessage('Waiting for bank connection to activate…');

    pollForConnection(storedCustomerId)
      .then(async (connId) => {
        if (!mountedRef.current) return; // #167: guard against unmount
        if (!connId) {
          setStatus('error');
          setMessage('Connection not found. Please try connecting again.');
          return;
        }
        // #511: write to org-scoped key
        lsSet('se_connection_id', orgId, connId);
        setConnectionId(connId);
        // #399: use org-scoped config doc id instead of global 'config/bank' singleton
        const bankCfgDocId = orgId ? orgDocId(orgId, 'bank') : 'bank';
        await setDoc(doc(db, 'config', bankCfgDocId), {
          connectionId: connId, customerId: storedCustomerId, connectedAt: new Date().toISOString(),
          orgId: orgId ?? null,
        });
        if (!mountedRef.current) return; // #167: guard after async setDoc
        // #535: pass orgId explicitly so fetchTransactions uses the current (non-stale) value
        await fetchTransactions(connId, orgId);
      })
      .catch((err) => {
        // #535: surface poll / setDoc errors instead of silently swallowing them
        if (!mountedRef.current) return;
        setStatus('error');
        setMessage(err?.message || 'Bank connection failed. Please try again.');
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]); // re-run if orgId changes (covers the post-redirect case correctly)

  // #535: accept explicit orgId arg so the post-return effect can pass the current value
  //        rather than relying on the closed-over one (which could still be null at mount time).
  const fetchTransactions = useCallback(async (connId, currentOrgId) => {
    const resolvedOrgId = currentOrgId ?? orgId;
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

      const count = await writeTransactions(data.transactions || [], resolvedOrgId);
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

      // #511: Persist customer_id under the org-scoped key before leaving
      lsSet('se_customer_id', orgId, data.customer_id);
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

      // orgId is current here (this is a user-initiated action, not a post-redirect effect)
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
    // #511: remove org-scoped keys, not the global ones
    lsRemove('se_connection_id', orgId);
    lsRemove('se_customer_id',   orgId);
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
