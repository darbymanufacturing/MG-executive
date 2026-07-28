import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, CheckCircle } from 'lucide-react';
import { useProjects } from '../../../context/ProjectContext.jsx';
import Modal from '../../Shared/Modal.jsx';
import Button from '../../Shared/Button.jsx';
import ConfirmDialog from '../../Shared/ConfirmDialog.jsx';
import EmptyState from '../../Shared/EmptyState.jsx';
import styles from './DecisionGatesTab.module.css';

const GATE_STATUSES = ['On Track', 'At Risk', 'Decided'];
const EMPTY_GATE = {
  name:          '',
  question:      '',
  threshold:     '',
  currentValue:  '',
  unit:          '€ revenue',
  decisionDate:  '',
  status:        'On Track',
  decision:      '',
  notes:         '',
};

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const [ty, tm, td] = dateStr.split('-').map(Number);
  const now = new Date();
  const [ny, nm, nd] = [now.getFullYear(), now.getMonth() + 1, now.getDate()];
  const target = Date.UTC(ty, tm - 1, td);
  const today  = Date.UTC(ny, nm - 1, nd);
  return Math.ceil((target - today) / 86400000);
}

function GateForm({ open, onClose, onSave, initial }) {
  const [form, setForm] = useState(EMPTY_GATE);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (open) { setForm(initial ? { ...EMPTY_GATE, ...initial } : EMPTY_GATE); setFormError(''); }
  }, [open, initial]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    const threshold    = Number(form.threshold);
    const currentValue = Number(form.currentValue);
    if (form.threshold !== '' && !Number.isFinite(threshold)) {
      setFormError('Please enter a valid number for threshold');
      return;
    }
    if (form.currentValue !== '' && !Number.isFinite(currentValue)) {
      setFormError('Please enter a valid number for current value');
      return;
    }
    setFormError('');
    setSaving(true);
    await onSave({
      ...form,
      threshold:    Number.isFinite(threshold)    ? threshold    : 0,
      currentValue: Number.isFinite(currentValue) ? currentValue : 0,
    });
    setSaving(false);
    onClose();
  }

  return (
    <Modal isOpen={open} onClose={onClose} title={initial ? 'Edit Decision Gate' : 'New Decision Gate'}>
      <form onSubmit={handleSubmit} className={styles.gateForm}>
        <div className={styles.field}>
          <label>Gate Name *</label>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Patras Expansion Decision" required />
        </div>
        <div className={styles.field}>
          <label>Decision Question</label>
          <input value={form.question} onChange={(e) => set('question', e.target.value)} placeholder="e.g. Did Nafplion + Corinth hit €60k revenue?" />
        </div>
        <div className={styles.grid3}>
          <div className={styles.field}>
            <label>Threshold</label>
            <input type="number" value={form.threshold} onChange={(e) => set('threshold', e.target.value)} placeholder="60000" />
          </div>
          <div className={styles.field}>
            <label>Current Value</label>
            <input type="number" value={form.currentValue} onChange={(e) => set('currentValue', e.target.value)} placeholder="0" />
          </div>
          <div className={styles.field}>
            <label>Unit</label>
            <input value={form.unit} onChange={(e) => set('unit', e.target.value)} placeholder="€ revenue" />
          </div>
        </div>
        <div className={styles.grid2}>
          <div className={styles.field}>
            <label>Decision Date</label>
            <input type="date" value={form.decisionDate} onChange={(e) => set('decisionDate', e.target.value)} />
          </div>
          <div className={styles.field}>
            <label>Status</label>
            <select value={form.status} onChange={(e) => set('status', e.target.value)}>
              {GATE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className={styles.field}>
          <label>Decision Recorded (once made)</label>
          <input value={form.decision} onChange={(e) => set('decision', e.target.value)} placeholder="e.g. Go — owned location" />
        </div>
        <div className={styles.field}>
          <label>Notes</label>
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} placeholder="Context, assumptions, conditions…" />
        </div>
        {formError && <p style={{ color: 'var(--status-red)', fontSize: 13, margin: '4px 0' }}>{formError}</p>}
        <div className={styles.formActions}>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save Changes' : 'Create Gate'}</Button>
        </div>
      </form>
    </Modal>
  );
}

const STATUS_COLOR = { 'On Track': '#22c55e', 'At Risk': '#f59e0b', 'Decided': '#6366f1' };

export default function DecisionGatesTab() {
  const { gates, addGate, updateGate, deleteGate } = useProjects();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [deleting, setDeleting] = useState(null);

  async function handleSave(form) {
    if (editing) await updateGate(editing._docId, form);
    else         await addGate(form);
    setEditing(null);
  }

  function openEdit(gate) { setEditing(gate); setFormOpen(true); }
  function openNew()      { setEditing(null); setFormOpen(true); }

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <h3 className={styles.title}>Decision Gates</h3>
          <p className={styles.sub}>Track key go/no-go decisions with thresholds and deadlines.</p>
        </div>
        <Button variant="primary" size="sm" onClick={openNew}>
          <Plus size={14} /> New Gate
        </Button>
      </div>

      {gates.length === 0 ? (
        <EmptyState
          icon={CheckCircle}
          title="No decision gates yet."
          description="Add a gate to track a key decision — like the Patras Q4 2026 revenue threshold."
          action={<Button variant="primary" onClick={openNew}><Plus size={14} /> New Gate</Button>}
        />
      ) : (
        <div className={styles.gateList}>
          {gates.map((g) => {
            const pct = g.threshold > 0 ? Math.min(100, Math.round((g.currentValue / g.threshold) * 100)) : null;
            const d   = daysUntil(g.decisionDate);
            const color = STATUS_COLOR[g.status] || 'var(--color-text-muted)';

            return (
              <div key={g._docId} className={styles.gateCard} style={{ borderLeftColor: color }}>
                <div className={styles.gateHeader}>
                  <div className={styles.gateLeft}>
                    <span className={styles.gateName}>{g.name}</span>
                    {g.question && <p className={styles.gateQ}>{g.question}</p>}
                  </div>
                  <div className={styles.gateRight}>
                    <span className={styles.gateStatus} style={{ color }}>{g.status}</span>
                    <button className={styles.iconBtn} onClick={() => openEdit(g)} title="Edit"><Pencil size={13} /></button>
                    <button className={styles.iconBtn} onClick={() => setDeleting(g._docId)} title="Delete"><Trash2 size={13} /></button>
                  </div>
                </div>

                {/* Progress bar */}
                {pct !== null && (
                  <div className={styles.progressWrap}>
                    <div className={styles.progressBar}>
                      <div
                        className={styles.progressFill}
                        style={{ width: `${pct}%`, background: pct >= 100 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444' }}
                      />
                    </div>
                    <div className={styles.progressLabels}>
                      <span>{g.currentValue.toLocaleString()} {g.unit}</span>
                      <span className={styles.progressPct}>{pct}%</span>
                      <span>Goal: {g.threshold.toLocaleString()} {g.unit}</span>
                    </div>
                  </div>
                )}

                <div className={styles.gateMeta}>
                  {g.decisionDate && (
                    <span className={`${styles.metaItem} ${d !== null && d < 30 ? styles.metaUrgent : ''}`}>
                      📅 {g.decisionDate}
                      {d !== null && ` (${d > 0 ? `${d}d away` : d === 0 ? 'Today' : `${Math.abs(d)}d past`})`}
                    </span>
                  )}
                  {g.decision && (
                    <span className={styles.metaItem}>✅ Decision: {g.decision}</span>
                  )}
                  {g.notes && (
                    <span className={styles.metaItem}>📝 {g.notes}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <GateForm
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onSave={handleSave}
        initial={editing}
      />

      <ConfirmDialog
        isOpen={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete Decision Gate"
        message="This will permanently delete this decision gate."
        confirmLabel="Delete"
        onConfirm={async () => { await deleteGate(deleting); setDeleting(null); }}
      />
    </div>
  );
}
