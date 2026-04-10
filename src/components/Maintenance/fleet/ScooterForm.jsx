import { useState, useEffect } from 'react';
import Modal from '../../Shared/Modal.jsx';
import Button from '../../Shared/Button.jsx';
import styles from './ScooterForm.module.css';

const MODELS   = ['ES400B 2022', 'ES400B 2023'];
const STATUSES = ['Active', 'In Repair', 'Retired', 'Donor'];

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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(initial ? { ...EMPTY, ...initial } : EMPTY);
  }, [open, initial]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.scooterId.trim()) return;
    setSaving(true);
    await onSave({
      ...form,
      purchasePrice: form.purchasePrice === '' ? null : Number(form.purchasePrice),
    });
    setSaving(false);
    onClose();
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
              required
              disabled={!!initial}
            />
          </div>

          <div className={styles.field}>
            <label>Model</label>
            <select value={form.model} onChange={(e) => set('model', e.target.value)}>
              {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div className={styles.field}>
            <label>City</label>
            <select value={form.city} onChange={(e) => set('city', e.target.value)}>
              <option value="">— Select city —</option>
              {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              {!cities.includes(form.city) && form.city && (
                <option value={form.city}>{form.city}</option>
              )}
            </select>
          </div>

          <div className={styles.field}>
            <label>Status</label>
            <select value={form.status} onChange={(e) => set('status', e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className={styles.field}>
            <label>Purchase Date</label>
            <input
              type="date"
              value={form.purchaseDate}
              onChange={(e) => set('purchaseDate', e.target.value)}
            />
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
            />
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
