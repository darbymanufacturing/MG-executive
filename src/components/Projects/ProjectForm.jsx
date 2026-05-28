import { useState, useEffect } from 'react';
import Modal from '../Shared/Modal.jsx';
import Button from '../Shared/Button.jsx';
import { validate } from '../../utils/validateForm.js';
import { projectSchema } from '../../utils/schemas/projectSchema.js';
import styles from './ProjectForm.module.css';

const errorStyle = {
  display: 'block',
  marginTop: '4px',
  fontSize: 'var(--text-xs)',
  color: 'var(--status-red)',
};

const inputErrorStyle = {
  borderColor: 'var(--status-red)',
};

const CATEGORIES = ['Expansion', 'Operations', 'Technology', 'Finance', 'Legal', 'Needs Setup'];
const OWNERS     = ['Kostas', 'Panos', 'Both'];
const STATUSES   = [
  { value: 'onTrack',        label: '🟢 On Track' },
  { value: 'needsAttention', label: '🟡 Needs Attention' },
  { value: 'blocked',        label: '🔴 Blocked' },
];

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const EMPTY = {
  name:        '',
  description: '',
  owner:       'Kostas',
  status:      'onTrack',
  category:    'Operations',
  startDate:   '',
  targetDate:  '',
};

export default function ProjectForm({ open, onClose, onSave, initial }) {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      const base = { ...EMPTY, startDate: todayLocal() };
      setForm(initial ? { ...base, ...initial } : base);
      setErrors({});
      setSaving(false);
    }
  }, [open, initial]);

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((prev) => ({ ...prev, [k]: undefined }));
  };

  async function handleSubmit(e) {
    e.preventDefault();
    const { isValid, errors: validationErrors } = validate(form, projectSchema);
    if (!isValid) { setErrors(validationErrors); return; }
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={open} onClose={onClose} title={initial ? 'Edit Project' : 'New Project'}>
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.field}>
          <label>Project Name *</label>
          <input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Nafplion Fleet Expansion"
            style={errors.name ? inputErrorStyle : undefined}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? 'project-name-error' : undefined}
          />
          {errors.name && <span id="project-name-error" style={errorStyle}>{errors.name}</span>}
        </div>

        <div className={styles.field}>
          <label>Description</label>
          <textarea
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="What are we trying to achieve and why it matters..."
            rows={3}
            style={errors.description ? inputErrorStyle : undefined}
          />
          {errors.description && <span style={errorStyle}>{errors.description}</span>}
        </div>

        <div className={styles.grid2}>
          <div className={styles.field}>
            <label>Status</label>
            <select value={form.status} onChange={(e) => set('status', e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label>Owner *</label>
            <select
              value={form.owner}
              onChange={(e) => set('owner', e.target.value)}
              style={errors.owner ? inputErrorStyle : undefined}
            >
              {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            {errors.owner && <span style={errorStyle}>{errors.owner}</span>}
          </div>

          <div className={styles.field}>
            <label>Category *</label>
            <select
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              style={errors.category ? inputErrorStyle : undefined}
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {errors.category && <span style={errorStyle}>{errors.category}</span>}
          </div>

          <div className={styles.field}>
            <label>Start Date</label>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => set('startDate', e.target.value)}
              style={errors.startDate ? inputErrorStyle : undefined}
            />
            {errors.startDate && <span style={errorStyle}>{errors.startDate}</span>}
          </div>

          <div className={styles.field}>
            <label>Target Completion</label>
            <input
              type="date"
              value={form.targetDate}
              onChange={(e) => set('targetDate', e.target.value)}
              style={errors.targetDate ? inputErrorStyle : undefined}
            />
            {errors.targetDate && <span style={errorStyle}>{errors.targetDate}</span>}
          </div>
        </div>

        <div className={styles.actions}>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : initial ? 'Save Changes' : 'Create Project'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
