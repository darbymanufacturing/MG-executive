import { useState, useEffect } from 'react';
import Modal from '../../Shared/Modal.jsx';
import Button from '../../Shared/Button.jsx';
import { validate } from '../../../utils/validateForm.js';
import { scooterSchema } from '../../../utils/schemas/scooterSchema.js';
import styles from './ScooterForm.module.css';

const MODELS   = ['ES400B 2022', 'ES400B 2023'];
const STATUSES = ['Active', 'In Repair', 'Retired', 'Donor'];

const errorStyle = {
  display: 'block',
  marginTop: '4px',
  fontSize: 'var(--text-xs)',
  color: 'var(--status-red)',
};

const inputErrorStyle = { borderColor: 'var(--status-red)' };

const EMPTY = {
  scooterId:     '',
  model:         'ES400B 2023',
  city:          '',
  status:        'Active',
  purchaseDate:  '',
  purchasePrice: '',
  notes:         '',
};

export default function ScooterForm({ open, onClose, onSave, initial, cities = [] }) {
  const [form, setForm]   = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initial ? { ...EMPTY, ...initial } : EMPTY);
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
    // Coerce purchasePrice for validation (empty string treated as omitted)
    const payload = {
      ...form,
      purchasePrice: form.purchasePrice === '' ? undefined : Number(form.purchasePrice),
    };
    const { isValid, errors: validationErrors } = validate(payload, scooterSchema);
    if (!isValid) { setErrors(validationErrors); return; }
    setSaving(true);
    try {
      await onSave({
        ...form,
        purchasePrice: form.purchasePrice === '' ? null : Number(form.purchasePrice),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={open} onClose={onClose} title={initial ? 'Edit Scooter' : 'Add Scooter'}>
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.grid2}>
          <div className={styles.field}>
            <label>Scooter ID *</label>
            <input
              value={form.scooterId}
              onChange={(e) => set('scooterId', e.target.value)}
              placeholder="e.g. 83846"
              disabled={!!initial}
              style={errors.scooterId ? inputErrorStyle : undefined}
              aria-invalid={!!errors.scooterId}
            />
            {errors.scooterId && <span style={errorStyle}>{errors.scooterId}</span>}
          </div>

          <div className={styles.field}>
            <label>Model *</label>
            <select
              value={form.model}
              onChange={(e) => set('model', e.target.value)}
              style={errors.model ? inputErrorStyle : undefined}
            >
              {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            {errors.model && <span style={errorStyle}>{errors.model}</span>}
          </div>

          <div className={styles.field}>
            <label>City *</label>
            <select
              value={form.city}
              onChange={(e) => set('city', e.target.value)}
              style={errors.city ? inputErrorStyle : undefined}
            >
              <option value="">— Select city —</option>
              {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              {!cities.includes(form.city) && form.city && (
                <option value={form.city}>{form.city}</option>
              )}
            </select>
            {errors.city && <span style={errorStyle}>{errors.city}</span>}
          </div>

          <div className={styles.field}>
            <label>Status *</label>
            <select
              value={form.status}
              onChange={(e) => set('status', e.target.value)}
              style={errors.status ? inputErrorStyle : undefined}
            >
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {errors.status && <span style={errorStyle}>{errors.status}</span>}
          </div>

          <div className={styles.field}>
            <label>Purchase Date</label>
            <input
              type="date"
              value={form.purchaseDate}
              onChange={(e) => set('purchaseDate', e.target.value)}
              style={errors.purchaseDate ? inputErrorStyle : undefined}
            />
            {errors.purchaseDate && <span style={errorStyle}>{errors.purchaseDate}</span>}
          </div>

          <div className={styles.field}>
            <label>Purchase Price (€)</label>
            <input
              type="number"
              value={form.purchasePrice}
              onChange={(e) => set('purchasePrice', e.target.value)}
              placeholder="e.g. 1800"
              min="0"
              step="0.01"
              style={errors.purchasePrice ? inputErrorStyle : undefined}
            />
            {errors.purchasePrice && <span style={errorStyle}>{errors.purchasePrice}</span>}
          </div>
        </div>

        <div className={styles.field}>
          <label>Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Any additional info…"
            rows={2}
          />
        </div>

        <div className={styles.actions}>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : initial ? 'Save Changes' : 'Add Scooter'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
