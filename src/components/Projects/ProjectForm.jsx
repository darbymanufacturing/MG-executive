import { useState, useEffect } from 'react';
import Modal from '../Shared/Modal.jsx';
import Button from '../Shared/Button.jsx';
import styles from './ProjectForm.module.css';

const CATEGORIES = ['Expansion', 'Operations', 'Technology', 'Finance', 'Legal'];
const OWNERS     = ['Kostas', 'Panos', 'Both'];
const STATUSES   = [
  { value: 'Green', label: '🟢 Green — On Track' },
  { value: 'Amber', label: '🟡 Amber — At Risk' },
  { value: 'Red',   label: '🔴 Red — Blocked' },
];

const EMPTY = {
  name:        '',
  description: '',
  owner:       'Kostas',
  status:      'Green',
  category:    'Operations',
  startDate:   new Date().toISOString().slice(0, 10),
  targetDate:  '',
};

export default function ProjectForm({ open, onClose, onSave, initial }) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(initial ? { ...EMPTY, ...initial } : EMPTY);
  }, [open, initial]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    await onSave(form);
    setSaving(false);
    onClose();
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
            required
          />
        </div>

        <div className={styles.field}>
          <label>Description</label>
          <textarea
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="What are we trying to achieve and why it matters..."
            rows={3}
          />
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
            <label>Owner</label>
            <select value={form.owner} onChange={(e) => set('owner', e.target.value)}>
              {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>

          <div className={styles.field}>
            <label>Category</label>
            <select value={form.category} onChange={(e) => set('category', e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className={styles.field}>
            <label>Start Date</label>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => set('startDate', e.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label>Target Completion</label>
            <input
              type="date"
              value={form.targetDate}
              onChange={(e) => set('targetDate', e.target.value)}
            />
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
