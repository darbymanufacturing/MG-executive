import { useState, useEffect } from 'react';
import Modal from '../Shared/Modal.jsx';
import Button from '../Shared/Button.jsx';
import { CATEGORIES, FREQUENCIES, CATEGORY_KEYS, FREQUENCY_KEYS } from '../../utils/constants.js';
import { formatEUR, todayISO } from '../../utils/formatters.js';
import { normalizeToMonthly } from '../../utils/calculations.js';
import styles from './CostFormModal.module.css';

const EMPTY = {
  name: '',
  category: 'fixed',
  amount: '',
  frequency: 'monthly',
  startDate: todayISO(),
  endDate: '',
  notes: '',
};

export default function CostFormModal({ isOpen, onClose, onSave, initialData }) {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const isEdit = !!initialData;

  useEffect(() => {
    if (isOpen) {
      setForm(initialData ? { ...EMPTY, ...initialData, endDate: initialData.endDate || '' } : EMPTY);
      setErrors({});
    }
  }, [isOpen, initialData]);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (!form.amount || isNaN(Number(form.amount)) || Number(form.amount) <= 0) e.amount = 'Enter a valid positive amount';
    if (!form.category) e.category = 'Category is required';
    if (!form.frequency) e.frequency = 'Frequency is required';
    return e;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    onSave({
      ...form,
      amount: parseFloat(form.amount),
      endDate: form.endDate || null,
    });
    onClose();
  };

  const preview = form.amount && !isNaN(Number(form.amount))
    ? normalizeToMonthly({ amount: Number(form.amount), frequency: form.frequency })
    : null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEdit ? 'Edit Cost' : 'Add Cost'} width={560}>
      <form onSubmit={handleSubmit} className={styles.form} noValidate>

        {/* Name */}
        <div className={styles.field}>
          <label className={styles.label}>Name *</label>
          <input
            className={`${styles.input} ${errors.name ? styles.inputError : ''}`}
            value={form.name}
            onChange={set('name')}
            placeholder="e.g. Monthly Insurance"
          />
          {errors.name && <span className={styles.error}>{errors.name}</span>}
        </div>

        {/* Category + Frequency row */}
        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Category *</label>
            <select
              className={`${styles.select} ${errors.category ? styles.inputError : ''}`}
              value={form.category}
              onChange={set('category')}
            >
              {CATEGORY_KEYS.map((k) => (
                <option key={k} value={k}>{CATEGORIES[k].fullLabel}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Frequency *</label>
            <select
              className={`${styles.select} ${errors.frequency ? styles.inputError : ''}`}
              value={form.frequency}
              onChange={set('frequency')}
            >
              {FREQUENCY_KEYS.map((k) => (
                <option key={k} value={k}>{FREQUENCIES[k].label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Amount */}
        <div className={styles.field}>
          <label className={styles.label}>Amount (EUR) *</label>
          <div className={styles.amountWrap}>
            <span className={styles.eurSymbol}>€</span>
            <input
              type="number"
              className={`${styles.input} ${styles.amountInput} ${errors.amount ? styles.inputError : ''}`}
              value={form.amount}
              onChange={set('amount')}
              placeholder="0.00"
              step="0.01"
              min="0"
            />
          </div>
          {preview !== null && (
            <span className={styles.preview}>
              ≈ {formatEUR(preview)}/month
            </span>
          )}
          {errors.amount && <span className={styles.error}>{errors.amount}</span>}
        </div>

        {/* Dates row */}
        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Start Date</label>
            <input type="date" className={styles.input} value={form.startDate} onChange={set('startDate')} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>End Date <span className={styles.optional}>(optional)</span></label>
            <input type="date" className={styles.input} value={form.endDate} onChange={set('endDate')} />
          </div>
        </div>

        {/* Notes */}
        <div className={styles.field}>
          <label className={styles.label}>Notes <span className={styles.optional}>(optional)</span></label>
          <textarea
            className={styles.textarea}
            value={form.notes}
            onChange={set('notes')}
            placeholder="Any additional details..."
            rows={2}
          />
        </div>

        {/* Actions */}
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">{isEdit ? 'Save Changes' : 'Add Cost'}</Button>
        </div>
      </form>
    </Modal>
  );
}
