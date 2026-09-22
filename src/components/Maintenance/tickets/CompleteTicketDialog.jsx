import { useMemo, useState } from 'react';
import { Minus, Plus, Search } from 'lucide-react';
import Modal from '../../Shared/Modal.jsx';
import { completionCostFields } from '../../../utils/maintenanceAutomation.js';
import { formatEUR } from '../../../utils/formatters.js';
import styles from './CompleteTicketDialog.module.css';

/**
 * CompleteTicketDialog — Autopilot Phase 3 (#694).
 *
 * "Mark Completed" used to write only a status and a date, so an admin-closed
 * repair cost €0 in Fleet P&L and never touched stock. This dialog asks for the
 * two facts that close that gap — minutes spent and parts used — and shows the
 * resulting cost live, computed by the SAME function MaintenanceContext uses
 * (completionCostFields → computeRepairPay), so what you see is what is saved.
 *
 * Both fields are optional: "Complete without cost" keeps the old one-click
 * behaviour for trivial closes.
 */
export default function CompleteTicketDialog({ ticket, parts = [], labourRatePerHour = 0, onConfirm, onClose }) {
  const [minutes, setMinutes] = useState('');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState({}); // partDocId → quantity
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const available = useMemo(
    () => parts.filter((p) => p.status !== 'Discontinued'),
    [parts],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return available
      .filter((p) => `${p.partName || ''} ${p.sku || ''}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [available, query]);

  const partsUsed = useMemo(
    () => Object.entries(picked)
      .filter(([, qty]) => qty > 0)
      .map(([docId, quantity]) => {
        const p = available.find((x) => x._docId === docId);
        return {
          partId: docId,
          sku: p?.sku,
          partName: p?.partName || p?.sku,
          quantity,
          unitCost: Number(p?.unitCost) || 0,
        };
      }),
    [picked, available],
  );

  const preview = completionCostFields({
    labourMinutes: Number(minutes) || 0,
    partsUsed,
    labourRatePerHour,
  });

  const bump = (docId, delta) =>
    setPicked((prev) => {
      const next = Math.max(0, (prev[docId] || 0) + delta);
      const copy = { ...prev };
      if (next === 0) delete copy[docId]; else copy[docId] = next;
      return copy;
    });

  const submit = async (withCost) => {
    setSaving(true);
    setError(null);
    try {
      await onConfirm(withCost
        ? { labourMinutes: Number(minutes) || 0, partsUsed, note: note.trim() || null }
        : { note: note.trim() || null });
      onClose();
    } catch (err) {
      setError(err?.message || String(err));
      setSaving(false);
    }
  };

  const stockOf = (docId) => Number(available.find((p) => p._docId === docId)?.stockOnHand) || 0;

  return (
    <Modal isOpen onClose={onClose} title={`Complete repair · #${ticket?.scooterId ?? ''}`} width={560}>
      <div className={styles.body}>
        {ticket?.issueDescription && <p className={styles.issue}>{ticket.issueDescription}</p>}

        <div className={styles.field}>
          <label htmlFor="ctd-minutes" className={styles.label}>Time spent (minutes)</label>
          <input
            id="ctd-minutes"
            className={styles.input}
            inputMode="numeric"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))}
            placeholder="e.g. 25"
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="ctd-parts" className={styles.label}>Parts used</label>
          <div className={styles.searchBox}>
            <Search size={14} aria-hidden="true" />
            <input
              id="ctd-parts"
              className={styles.searchInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search part name or SKU"
            />
          </div>
          {matches.length > 0 && (
            <ul className={styles.results}>
              {matches.map((p) => (
                <li key={p._docId}>
                  <button type="button" className={styles.result} onClick={() => { bump(p._docId, 1); setQuery(''); }}>
                    <span>{p.partName || p.sku}</span>
                    <span className={styles.resultMeta}>
                      {Number(p.stockOnHand) || 0} in stock · {formatEUR(Number(p.unitCost) || 0)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {partsUsed.length > 0 && (
            <ul className={styles.picked}>
              {partsUsed.map((p) => (
                <li key={p.partId} className={styles.pickedRow}>
                  <span className={styles.pickedName}>{p.partName}</span>
                  {p.quantity > stockOf(p.partId) && (
                    <span className={styles.warn}>only {stockOf(p.partId)} in stock</span>
                  )}
                  <span className={styles.stepper}>
                    <button type="button" aria-label={`One fewer ${p.partName}`} onClick={() => bump(p.partId, -1)}><Minus size={12} /></button>
                    <span className={styles.qty}>{p.quantity}</span>
                    <button type="button" aria-label={`One more ${p.partName}`} onClick={() => bump(p.partId, 1)}><Plus size={12} /></button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor="ctd-note" className={styles.label}>Note (optional)</label>
          <input id="ctd-note" className={styles.input} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className={styles.costBox}>
          {preview.totalCost != null ? (
            <>
              <span>Labour {formatEUR(preview.labourCost)} · Parts {formatEUR(preview.totalPartsCost)}</span>
              <strong>{formatEUR(preview.totalCost)}</strong>
            </>
          ) : (
            <span className={styles.muted}>Add time or parts to cost this repair — it goes to Cost Approvals.</span>
          )}
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={() => submit(false)} disabled={saving}>
            Complete without cost
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={() => submit(true)}
            disabled={saving || preview.totalCost == null}
          >
            {saving ? 'Saving…' : 'Complete repair'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
