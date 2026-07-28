import { useState, useRef, useEffect } from 'react';
import {
  Plus, Pencil, Trash2, ChevronUp, ChevronDown, Camera, X, BookOpen, Clock, Loader2,
} from 'lucide-react';
import { useRepairProcedures } from '../../../context/RepairProcedureContext.jsx';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import Button from '../../Shared/Button.jsx';
import Modal from '../../Shared/Modal.jsx';
import ConfirmDialog from '../../Shared/ConfirmDialog.jsx';
import EmptyState from '../../Shared/EmptyState.jsx';
import styles from './RepairProcedureEditor.module.css';

const TICKET_CATEGORIES = {
  Q: 'Quick (<2 hr)',
  M: 'Medium / Estimated',
  C: 'Complex',
  B: 'Blocked',
  F: 'Finished',
};

function blankStep(number) {
  return { stepNumber: number, instruction: '', notes: '', requiresPhoto: false };
}

function blankForm() {
  return {
    title: '',
    category: 'Q',
    estimatedMinutes: 30,
    steps: [blankStep(1)],
    commonParts: [],
  };
}

// ── Step builder row ──────────────────────────────────────────────────────────
function StepRow({ step, index, total, onChange, onRemove, onMove }) {
  return (
    <div className={styles.stepRow}>
      <div className={styles.stepLeft}>
        <span className={styles.stepNum}>{step.stepNumber}</span>
        <div className={styles.stepReorder}>
          <button
            type="button"
            className={styles.reorderBtn}
            onClick={() => onMove(index, -1)}
            disabled={index === 0}
            aria-label="Move up"
          >
            <ChevronUp size={13} />
          </button>
          <button
            type="button"
            className={styles.reorderBtn}
            onClick={() => onMove(index, 1)}
            disabled={index === total - 1}
            aria-label="Move down"
          >
            <ChevronDown size={13} />
          </button>
        </div>
      </div>

      <div className={styles.stepBody}>
        <input
          className={styles.stepInput}
          placeholder="Step instruction…"
          value={step.instruction}
          onChange={(e) => onChange(index, 'instruction', e.target.value)}
        />
        <input
          className={`${styles.stepInput} ${styles.stepNotes}`}
          placeholder="Optional notes / tips…"
          value={step.notes}
          onChange={(e) => onChange(index, 'notes', e.target.value)}
        />
        <label className={styles.photoToggle}>
          <input
            type="checkbox"
            checked={step.requiresPhoto}
            onChange={(e) => onChange(index, 'requiresPhoto', e.target.checked)}
          />
          <Camera size={13} />
          <span>Requires photo</span>
        </label>
      </div>

      <button
        type="button"
        className={styles.removeStepBtn}
        onClick={() => onRemove(index)}
        disabled={total === 1}
        aria-label="Remove step"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ── Searchable part combobox ──────────────────────────────────────────────────
function PartCombobox({ value, parts, onSelect }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const selectedPart = parts.find((p) => p._docId === value || p.sku === value || p.id === value);
  const displayValue = open ? query : (selectedPart ? selectedPart.partName : '');

  const filtered = query.trim()
    ? parts.filter((p) =>
        p.partName.toLowerCase().includes(query.toLowerCase()) ||
        p.sku?.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 10)
    : parts.slice(0, 10);

  useEffect(() => {
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  function handleFocus() {
    setQuery('');
    setOpen(true);
  }

  function handlePick(part) {
    onSelect(part);
    setOpen(false);
    setQuery('');
  }

  return (
    <div className={styles.comboWrap} ref={ref}>
      <input
        className={styles.comboInput}
        placeholder={value ? selectedPart?.partName ?? 'Unknown part' : 'Search part name or SKU…'}
        value={displayValue}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={handleFocus}
      />
      {open && filtered.length > 0 && (
        <ul className={styles.comboDropdown}>
          {filtered.map((p) => (
            <li
              key={p.id}
              className={`${styles.comboOption} ${p.id === value ? styles.comboOptionActive : ''}`}
              onMouseDown={() => handlePick(p)}
            >
              <span className={styles.comboOptionName}>{p.partName}</span>
              <span className={styles.comboOptionSku}>{p.sku}</span>
            </li>
          ))}
        </ul>
      )}
      {open && filtered.length === 0 && (
        <div className={styles.comboEmpty}>No parts match "{query}"</div>
      )}
    </div>
  );
}

// ── Common parts picker row ───────────────────────────────────────────────────
function PartPickerRow({ entry, parts, onChange, onRemove }) {
  return (
    <div className={styles.partRow}>
      <PartCombobox
        value={entry.partId}
        parts={parts}
        onSelect={(part) => onChange({ partId: part.id, partName: part.partName, defaultQty: entry.defaultQty })}
      />
      <div className={styles.partRowRight}>
        <label className={styles.partQtyLabel}>Qty</label>
        <input
          type="number"
          className={styles.partQty}
          min={1}
          max={99}
          value={entry.defaultQty}
          onChange={(e) => onChange({ ...entry, defaultQty: Math.max(1, parseInt(e.target.value) || 1) })}
        />
        <button type="button" className={styles.removeStepBtn} onClick={onRemove} aria-label="Remove part">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Create / Edit modal ───────────────────────────────────────────────────────
function ProcedureModal({ isOpen, onClose, initial }) {
  const { addProcedure, updateProcedure } = useRepairProcedures();
  const { parts } = useMaintenance();

  const [form, setForm] = useState(initial ?? blankForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setForm(initial ?? blankForm());
      setError('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initial?.id]);

  const isEdit = !!initial?.id;

  function setField(key, val) {
    setForm((prev) => ({ ...prev, [key]: val }));
  }

  // ── Steps ──
  function addStep() {
    setField('steps', [...form.steps, blankStep(form.steps.length + 1)]);
  }

  function removeStep(idx) {
    const next = form.steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, stepNumber: i + 1 }));
    setField('steps', next);
  }

  function changeStep(idx, key, val) {
    const next = form.steps.map((s, i) => i === idx ? { ...s, [key]: val } : s);
    setField('steps', next);
  }

  function moveStep(idx, dir) {
    const arr = [...form.steps];
    const target = idx + dir;
    if (target < 0 || target >= arr.length) return;
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    setField('steps', arr.map((s, i) => ({ ...s, stepNumber: i + 1 })));
  }

  // ── Common parts ──
  function addPart() {
    setField('commonParts', [...form.commonParts, { partId: '', partName: '', defaultQty: 1 }]);
  }

  function changePart(idx, val) {
    const next = form.commonParts.map((p, i) => i === idx ? val : p);
    setField('commonParts', next);
  }

  function removePart(idx) {
    setField('commonParts', form.commonParts.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (!form.title.trim()) { setError('Title is required.'); return; }
    if (form.steps.some((s) => !s.instruction.trim())) { setError('All steps need an instruction.'); return; }
    setError('');
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        category: form.category,
        estimatedMinutes: Number(form.estimatedMinutes) || 30,
        steps: form.steps,
        commonParts: form.commonParts.filter((p) => p.partId),
      };
      if (isEdit) {
        await updateProcedure(initial.id, payload);
      } else {
        await addProcedure(payload);
      }
      onClose();
    } catch (err) {
      console.error('[RepairProcedureEditor] handleSave failed:', err);
      const isOffline = err.message?.includes('client is offline') || err.code === 'unavailable';
      const isPermission = err.code === 'permission-denied' || err.message?.includes('PERMISSION_DENIED');
      if (isOffline) {
        setError('Could not save — you appear to be offline. Check your connection and try again.');
      } else if (isPermission) {
        setError('Save failed — you do not have permission to edit procedures. Contact your administrator.');
      } else {
        setError('Could not save the procedure. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  // Reset form when modal opens/closes
  function handleClose() {
    setForm(initial ?? blankForm());
    setError('');
    onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={isEdit ? 'Edit Procedure' : 'New Repair Procedure'}>
      <div className={styles.modalBody}>
        {/* Basic info */}
        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label className={styles.label}>Title *</label>
            <input
              className={styles.input}
              placeholder="e.g. Brake Pad Replacement"
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Ticket Category</label>
            <select className={styles.input} value={form.category} onChange={(e) => setField('category', e.target.value)}>
              {Object.entries(TICKET_CATEGORIES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Estimated Time (min)</label>
            <input
              type="number"
              className={styles.input}
              min={5}
              step={5}
              value={form.estimatedMinutes}
              onChange={(e) => setField('estimatedMinutes', e.target.value)}
            />
          </div>
        </div>

        {/* Steps */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>Steps</span>
            <button type="button" className={styles.addBtn} onClick={addStep}>
              <Plus size={13} /> Add step
            </button>
          </div>
          <div className={styles.stepList}>
            {form.steps.map((step, idx) => (
              <StepRow
                key={idx}
                step={step}
                index={idx}
                total={form.steps.length}
                onChange={changeStep}
                onRemove={removeStep}
                onMove={moveStep}
              />
            ))}
          </div>
        </div>

        {/* Common parts */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>Pre-filled Parts (suggestions)</span>
            <button type="button" className={styles.addBtn} onClick={addPart}>
              <Plus size={13} /> Add part
            </button>
          </div>
          {form.commonParts.length === 0 ? (
            <p className={styles.emptyHint}>No pre-filled parts. Technicians can still pick parts during repair.</p>
          ) : (
            <div className={styles.partList}>
              {form.commonParts.map((entry, idx) => (
                <PartPickerRow
                  key={idx}
                  entry={entry}
                  parts={parts}
                  onChange={(val) => changePart(idx, val)}
                  onRemove={() => removePart(idx)}
                />
              ))}
            </div>
          )}
        </div>

        {error && <p className={styles.errorMsg}>{error}</p>}

        <div className={styles.modalFooter}>
          <Button variant="outline" size="sm" onClick={handleClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 size={14} className={styles.spin} /> Saving…</> : isEdit ? 'Save Changes' : 'Create Procedure'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Procedure card ────────────────────────────────────────────────────────────
function ProcedureCard({ proc, onEdit, onDelete }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardTop}>
        <div className={styles.cardInfo}>
          <span className={styles.cardTitle}>{proc.title}</span>
          <div className={styles.cardMeta}>
            <span className={styles.cardCategory}>{TICKET_CATEGORIES[proc.category] ?? proc.category}</span>
            <span className={styles.cardDot}>·</span>
            <Clock size={12} />
            <span>{proc.estimatedMinutes} min</span>
            <span className={styles.cardDot}>·</span>
            <span>{proc.steps?.length ?? 0} step{proc.steps?.length !== 1 ? 's' : ''}</span>
            {proc.commonParts?.length > 0 && (
              <>
                <span className={styles.cardDot}>·</span>
                <span>{proc.commonParts.length} part{proc.commonParts.length !== 1 ? 's' : ''} pre-filled</span>
              </>
            )}
          </div>
        </div>
        <div className={styles.cardActions}>
          <button className={styles.iconBtn} onClick={onEdit} aria-label="Edit">
            <Pencil size={14} />
          </button>
          <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={onDelete} aria-label="Delete">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main editor ───────────────────────────────────────────────────────────────
export default function RepairProcedureEditor() {
  const { procedures, loading, deleteProcedure } = useRepairProcedures();
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null); // procedure or null
  const [deleteTarget, setDeleteTarget] = useState(null);

  function openCreate() { setEditTarget(null); setModalOpen(true); }
  function openEdit(proc) { setEditTarget(proc); setModalOpen(true); }

  async function confirmDelete() {
    if (deleteTarget) await deleteProcedure(deleteTarget.id);
    setDeleteTarget(null);
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <Button variant="primary" size="sm" onClick={openCreate}>
          <Plus size={14} /> New Procedure
        </Button>
      </div>

      {loading ? (
        <p className={styles.loadingMsg}>Loading procedures…</p>
      ) : procedures.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No repair procedures yet"
          description="Create your first SOP — technicians will follow these step-by-step during repairs."
        />
      ) : (
        <div className={styles.list}>
          {procedures.map((proc) => (
            <ProcedureCard
              key={proc.id}
              proc={proc}
              onEdit={() => openEdit(proc)}
              onDelete={() => setDeleteTarget(proc)}
            />
          ))}
        </div>
      )}

      <ProcedureModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        initial={editTarget}
      />

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete Procedure"
        message={`Delete "${deleteTarget?.title}"? This cannot be undone. Active repair sessions referencing this procedure will be unaffected.`}
        confirmLabel="Delete"
      />
    </div>
  );
}
