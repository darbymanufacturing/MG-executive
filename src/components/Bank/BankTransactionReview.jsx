import { useState, useEffect, useCallback, useRef } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { CheckSquare, Square, EyeOff, Download, Inbox } from 'lucide-react';
import { db } from '../../lib/firebase.js';
import { useCosts } from '../../context/CostContext.jsx';
import { useOrg } from '../../context/OrgContext.jsx';
import { CATEGORY_KEYS } from '../../utils/constants.js';
import { formatEUR } from '../../utils/formatters.js';
import Button from '../Shared/Button.jsx';
import styles from './BankTransactionReview.module.css';

const BANK_TX_COL = 'bankTransactions';
const BATCH_SIZE  = 450;

export default function BankTransactionReview() {
  const { addCost } = useCosts();
  const { orgId } = useOrg();
  const [pending,   setPending]   = useState([]);
  const [selected,  setSelected]  = useState(new Set());
  const [importing, setImporting] = useState(false);
  const [doneMsg,   setDoneMsg]   = useState('');
  // #169: track doneMsg timer to clear on unmount
  const doneMsgTimerRef = useRef(null);
  useEffect(() => {
    return () => { if (doneMsgTimerRef.current) clearTimeout(doneMsgTimerRef.current); };
  }, []);

  // ── Real-time listener for pending bank transactions ──────────────────────
  useEffect(() => {
    if (!orgId) return;
    // #168: only fetch pending; #397: scope to caller's org to prevent cross-tenant leaks
    const q = query(
      collection(db, BANK_TX_COL),
      where('status', '==', 'pending'),
      where('orgId', '==', orgId),
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs
        .map((d) => ({ _docId: d.id, ...d.data() }))
        .sort((a, b) => (b.bookingDate || '').localeCompare(a.bookingDate || ''));
      setPending(rows);
      // Auto-select all new rows
      setSelected((prev) => {
        const next = new Set(prev);
        rows.forEach((r) => next.add(r._docId));
        return next;
      });
    });
    return unsub;
  }, []);

  // ── Category edit ────────────────────────────────────────────────────────
  // #170: capture previous value for rollback on failure
  const handleCategoryChange = useCallback(async (docId, category) => {
    // Capture previous category for rollback
    const prev = pending.find((r) => r._docId === docId);
    const previousCategory = prev?.category;
    // Optimistic update
    setPending((rows) => rows.map((r) => r._docId === docId ? { ...r, category } : r));
    try {
      await updateDoc(doc(db, BANK_TX_COL, docId), { category });
    } catch (err) {
      console.error('Failed to update category:', err);
      // Rollback on failure
      setPending((rows) => rows.map((r) => r._docId === docId ? { ...r, category: previousCategory } : r));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  // ── Select / deselect ────────────────────────────────────────────────────
  const toggleAll = () => {
    if (selected.size === pending.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pending.map((r) => r._docId)));
    }
  };

  // ── Import selected ──────────────────────────────────────────────────────
  const handleImport = async () => {
    const toImport = pending.filter((r) => selected.has(r._docId));
    if (toImport.length === 0) return;

    setImporting(true);
    try {
      // Add costs
      for (const row of toImport) {
        await addCost({
          name:       row.name,
          amount:     row.amount,
          startDate:  row.startDate || row.bookingDate,
          frequency:  row.frequency || 'one-time',
          category:   row.category  || 'variable',
          notes:      row.notes     || null,
          _bankTxId:  row._docId,
        });
      }

      // Mark as imported in batch
      for (let i = 0; i < toImport.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        toImport.slice(i, i + BATCH_SIZE).forEach((row) => {
          batch.update(doc(db, BANK_TX_COL, row._docId), {
            status: 'imported',
            importedAt: new Date().toISOString(),
          });
        });
        await batch.commit();
      }

      setSelected(new Set());
      setDoneMsg(`${toImport.length} cost entr${toImport.length !== 1 ? 'ies' : 'y'} added to Cost Manager.`);
      // #169: track timer in ref to clear on unmount
      if (doneMsgTimerRef.current) clearTimeout(doneMsgTimerRef.current);
      doneMsgTimerRef.current = setTimeout(() => setDoneMsg(''), 5000);
    } finally {
      setImporting(false);
    }
  };

  // ── Ignore selected ──────────────────────────────────────────────────────
  const handleIgnore = async (docId) => {
    await updateDoc(doc(db, BANK_TX_COL, docId), { status: 'ignored' });
    setSelected((prev) => { const next = new Set(prev); next.delete(docId); return next; });
  };

  if (pending.length === 0) {
    return (
      <div className={styles.empty}>
        <Inbox size={28} className={styles.emptyIcon} />
        <p>No pending bank transactions.</p>
        <p className={styles.emptyHint}>Connect your bank and sync to pull in transactions.</p>
      </div>
    );
  }

  const allChecked = selected.size === pending.length;

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <span className={styles.count}>{pending.length} pending transaction{pending.length !== 1 ? 's' : ''}</span>
        <div className={styles.toolbarActions}>
          <Button variant="ghost" size="sm" onClick={toggleAll}>
            {allChecked ? <CheckSquare size={14} /> : <Square size={14} />}
            {allChecked ? 'Deselect all' : 'Select all'}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleImport}
            disabled={selected.size === 0 || importing}
          >
            <Download size={14} />
            {importing ? 'Importing…' : `Import ${selected.size > 0 ? selected.size : ''} selected`}
          </Button>
        </div>
      </div>

      {doneMsg && <div className={styles.doneMsg}>{doneMsg}</div>}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thCheck} />
              <th>Date</th>
              <th>Description</th>
              <th className={styles.thAmount}>Amount</th>
              <th>Category</th>
              <th className={styles.thAction} />
            </tr>
          </thead>
          <tbody>
            {pending.map((row) => (
              <tr
                key={row._docId}
                className={`${styles.tr} ${selected.has(row._docId) ? styles.trSelected : ''}`}
              >
                <td className={styles.tdCheck}>
                  <button
                    className={styles.checkBtn}
                    onClick={() => setSelected((prev) => {
                      const next = new Set(prev);
                      next.has(row._docId) ? next.delete(row._docId) : next.add(row._docId);
                      return next;
                    })}
                  >
                    {selected.has(row._docId) ? <CheckSquare size={15} /> : <Square size={15} />}
                  </button>
                </td>
                <td className={styles.tdDate}>{row.bookingDate || '—'}</td>
                <td className={styles.tdDesc}>{row.name}</td>
                <td className={styles.tdAmount}>{formatEUR(row.amount)}</td>
                <td className={styles.tdCategory}>
                  <select
                    className={styles.categorySelect}
                    value={row.category || 'variable'}
                    onChange={(e) => handleCategoryChange(row._docId, e.target.value)}
                  >
                    {CATEGORY_KEYS.map((k) => (
                      <option key={k} value={k}>{k.replace('-', ' ')}</option>
                    ))}
                  </select>
                </td>
                <td className={styles.tdAction}>
                  <button
                    className={styles.ignoreBtn}
                    title="Ignore this transaction"
                    onClick={() => handleIgnore(row._docId)}
                  >
                    <EyeOff size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
