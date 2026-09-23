import { useMemo, useState } from 'react';
import { ClipboardCopy, Check, PackageSearch, PackageCheck } from 'lucide-react';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import { draftOrderText } from '../../../utils/maintenanceAutomation.js';
import { formatEUR } from '../../../utils/formatters.js';
import styles from './ReorderPanel.module.css';

/**
 * ReorderPanel — Autopilot Phase 3.
 *
 * Turns "which parts are low?" into a ready-to-send order per supplier.
 * Deliberately a DRAFT: the owner chose "hold until approved", and nothing that
 * talks to a supplier or spends money leaves Omni on its own. Copy the text,
 * send it, then "Mark ordered" records the units on order so the part drops off
 * this list and its stock can be received later.
 */
export default function ReorderPanel() {
  const { reorder = [], updatePart, parts = [], receiveParts } = useMaintenance();
  const [copied, setCopied] = useState(null);
  const [marking, setMarking] = useState(null);
  const [receiving, setReceiving] = useState(null);

  const orders = useMemo(() => draftOrderText(reorder, { company: 'Omni' }), [reorder]);
  // Autopilot — what's been ordered and not delivered yet (closes the loop).
  const onOrder = useMemo(
    () => parts.filter((p) => Number(p.unitsOnOrder) > 0 && p.status !== 'Discontinued'),
    [parts],
  );

  if (reorder.length === 0 && onOrder.length === 0) return null;

  const received = async (part) => {
    setReceiving(part._docId);
    try {
      await receiveParts([{ partId: part._docId, qty: Number(part.unitsOnOrder) }]);
    } finally {
      setReceiving(null);
    }
  };

  const copy = async (order) => {
    try {
      await navigator.clipboard.writeText(order.text);
      setCopied(order.supplier);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  const markOrdered = async (supplier) => {
    setMarking(supplier);
    const today = new Date().toISOString().slice(0, 10);
    try {
      for (const s of reorder.filter((x) => (x.supplier || 'Unassigned supplier') === supplier)) {
        await updatePart(s.docId, { unitsOnOrder: s.quantity, orderDate: today, status: 'On Order' });
      }
    } finally {
      setMarking(null);
    }
  };

  return (
    <section className={styles.panel} aria-labelledby="reorder-title">
      <header className={styles.head}>
        <PackageSearch size={16} aria-hidden="true" />
        <h3 id="reorder-title" className={styles.title}>Reorder now</h3>
        <span className={styles.count}>
          {reorder.length} part{reorder.length === 1 ? '' : 's'} below reorder point
          {onOrder.length ? ` · ${onOrder.length} on order` : ''}
        </span>
      </header>

      {orders.map((order) => (
        <div key={order.supplier} className={styles.order}>
          <div className={styles.orderHead}>
            <span className={styles.supplier}>{order.supplier}</span>
            <span className={styles.total}>{formatEUR(order.total)}</span>
          </div>
          <ul className={styles.lines}>
            {reorder
              .filter((s) => (s.supplier || 'Unassigned supplier') === order.supplier)
              .map((s) => (
                <li key={s.docId} className={styles.line}>
                  <span className={styles.qty}>{s.quantity} ×</span>
                  <span className={styles.name}>{s.partName}</span>
                  <span className={styles.stock}>{s.stockOnHand} left · reorder at {s.reorderPoint}</span>
                </li>
              ))}
          </ul>
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={() => copy(order)}>
              {copied === order.supplier ? <Check size={14} /> : <ClipboardCopy size={14} />}
              {copied === order.supplier ? 'Copied' : 'Copy order'}
            </button>
            <button
              type="button"
              className={styles.primary}
              onClick={() => markOrdered(order.supplier)}
              disabled={marking === order.supplier}
            >
              {marking === order.supplier ? 'Saving…' : 'Mark ordered'}
            </button>
          </div>
        </div>
      ))}

      {onOrder.length > 0 && (
        <div className={styles.order}>
          <div className={styles.orderHead}>
            <span className={styles.supplier}>On order — waiting for delivery</span>
          </div>
          <ul className={styles.lines}>
            {onOrder.map((p) => (
              <li key={p._docId} className={styles.line}>
                <span className={styles.qty}>{p.unitsOnOrder} ×</span>
                <span className={styles.name}>{p.partName || p.name || p.sku}</span>
                <span className={styles.stock}>{p.orderDate ? `ordered ${p.orderDate}` : 'ordered'}</span>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => received(p)}
                  disabled={receiving === p._docId}
                  title="Put the delivered units on the shelf"
                >
                  <PackageCheck size={14} /> {receiving === p._docId ? 'Saving…' : 'Received'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
