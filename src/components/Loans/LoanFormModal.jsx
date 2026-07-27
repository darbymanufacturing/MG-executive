import { useState, useEffect } from 'react';
import { Landmark, CreditCard } from 'lucide-react';
import Modal from '../Shared/Modal.jsx';
import Button from '../Shared/Button.jsx';
import { todayISO } from '../../utils/formatters.js';
import styles from './LoanFormModal.module.css';

const EMPTY = {
  name: '',
  type: 'loan', // 'loan' | 'credit-card'
  lender: '',
  principalAmount: '',
  creditLimit: '',
  currentBalance: '',
  interestRate: '',
  monthlyPayment: '',
  startDate: '',
  notes: '',
};

function toFormValue(v) {
  return v === null || v === undefined ? '' : String(v);
}

/** name required · balance ≥ 0 · limit > 0 for cards · rate/payment ≥ 0 when given. */
function validate(form) {
  const errs = {};
  if (!form.name.trim()) errs.name = 'Name is required';

  if (form.currentBalance !== '') {
    const bal = Number(form.currentBalance);
    if (isNaN(bal) || bal < 0) errs.currentBalance = 'Must be 0 or more';
  }

  if (form.type === 'credit-card') {
    const limit = Number(form.creditLimit);
    if (form.creditLimit === '' || isNaN(limit) || limit <= 0) {
      errs.creditLimit = 'Credit limit must be greater than 0';
    }
  } else if (form.principalAmount !== '') {
    const p = Number(form.principalAmount);
    if (isNaN(p) || p < 0) errs.principalAmount = 'Must be 0 or more';
  }

  if (form.interestRate !== '') {
    const r = Number(form.interestRate);
    if (isNaN(r) || r < 0) errs.interestRate = 'Must be 0 or more';
  }
  if (form.monthlyPayment !== '') {
    const m = Number(form.monthlyPayment);
    if (isNaN(m) || m < 0) errs.monthlyPayment = 'Must be 0 or more';
  }
  return errs;
}

/**
 * Add/Edit modal for a manually-tracked loan or credit card. Also opens for
 * CSV-imported loans (initialData with no `manual` flag) so the owner can layer a
 * rate/payment/notes on top of one — currentBalance/entries stay bank-derived either
 * way, this only ever touches the metadata fields below.
 */
export default function LoanFormModal({ isOpen, onClose, onSave, initialData }) {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const isEdit = !!initialData?._docId;

  useEffect(() => {
    if (!isOpen) return;
    setForm(initialData ? {
      name: initialData.name || '',
      type: initialData.type === 'credit-card' ? 'credit-card' : 'loan',
      lender: toFormValue(initialData.lender),
      principalAmount: toFormValue(initialData.principalAmount),
      creditLimit: toFormValue(initialData.creditLimit),
      currentBalance: toFormValue(initialData.currentBalance),
      interestRate: toFormValue(initialData.interestRate),
      monthlyPayment: toFormValue(initialData.monthlyPayment),
      startDate: initialData.startDate || '',
      notes: initialData.notes || '',
    } : { ...EMPTY, startDate: todayISO() });
    setErrors({});
    setSaving(false);
  }, [isOpen, initialData]);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const isCard = form.type === 'credit-card';

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate(form);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    try {
      await onSave({
        name: form.name.trim(),
        type: form.type,
        lender: form.lender.trim() || null,
        principalAmount: !isCard && form.principalAmount !== '' ? Number(form.principalAmount) : null,
        creditLimit: isCard && form.creditLimit !== '' ? Number(form.creditLimit) : null,
        currentBalance: form.currentBalance !== '' ? Number(form.currentBalance) : null,
        interestRate: form.interestRate !== '' ? Number(form.interestRate) : null,
        monthlyPayment: form.monthlyPayment !== '' ? Number(form.monthlyPayment) : null,
        startDate: form.startDate || null,
        notes: form.notes.trim() || null,
      });
      onClose();
    } catch (err) {
      setErrors((prev) => ({ ...prev, _submit: err.message }));
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEdit ? 'Edit debt' : 'Add loan / card'} width={520}>
      <form onSubmit={handleSubmit} className={styles.form}>

        {/* Type selector */}
        <div className={styles.field}>
          <label className={styles.label}>Type</label>
          <div className={styles.typeToggle} role="radiogroup" aria-label="Debt type">
            <button
              type="button"
              role="radio"
              aria-checked={!isCard}
              className={`${styles.typeBtn} ${!isCard ? styles.typeActive : ''}`}
              onClick={() => setForm((f) => ({ ...f, type: 'loan' }))}
            >
              <Landmark size={14} /> Loan
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={isCard}
              className={`${styles.typeBtn} ${isCard ? styles.typeActive : ''}`}
              onClick={() => setForm((f) => ({ ...f, type: 'credit-card' }))}
            >
              <CreditCard size={14} /> Credit card
            </button>
          </div>
        </div>

        {/* Name */}
        <div className={styles.field}>
          <label className={styles.label}>Name *</label>
          <input
            className={`${styles.input} ${errors.name ? styles.inputError : ''}`}
            value={form.name}
            onChange={set('name')}
            placeholder={isCard ? 'e.g. Eurobank Visa Business' : 'e.g. Piraeus Bank van loan'}
          />
          {errors.name && <span className={styles.error}>{errors.name}</span>}
        </div>

        {/* Lender / Issuer */}
        <div className={styles.field}>
          <label className={styles.label}>{isCard ? 'Issuer' : 'Lender / bank'}</label>
          <input
            className={styles.input}
            value={form.lender}
            onChange={set('lender')}
            placeholder={isCard ? 'e.g. Eurobank' : 'e.g. Alpha Bank'}
          />
        </div>

        {/* Original amount / Credit limit + Current balance */}
        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>{isCard ? 'Credit limit (€) *' : 'Original amount (€)'}</label>
            <input
              type="number"
              inputMode="decimal"
              className={`${styles.input} ${errors.principalAmount || errors.creditLimit ? styles.inputError : ''}`}
              value={isCard ? form.creditLimit : form.principalAmount}
              onChange={set(isCard ? 'creditLimit' : 'principalAmount')}
              placeholder={isCard ? 'e.g. 10000' : 'e.g. 25000'}
              step="0.01"
              min="0"
            />
            {(errors.creditLimit || errors.principalAmount) && (
              <span className={styles.error}>{errors.creditLimit || errors.principalAmount}</span>
            )}
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Current balance (€)</label>
            <input
              type="number"
              inputMode="decimal"
              className={`${styles.input} ${errors.currentBalance ? styles.inputError : ''}`}
              value={form.currentBalance}
              onChange={set('currentBalance')}
              placeholder="e.g. 12500"
              step="0.01"
              min="0"
            />
            {errors.currentBalance && <span className={styles.error}>{errors.currentBalance}</span>}
          </div>
        </div>

        {/* Interest rate + payment */}
        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>{isCard ? 'APR (%)' : 'Interest rate (% APR)'}</label>
            <input
              type="number"
              inputMode="decimal"
              className={`${styles.input} ${errors.interestRate ? styles.inputError : ''}`}
              value={form.interestRate}
              onChange={set('interestRate')}
              placeholder="e.g. 5.5"
              step="0.01"
              min="0"
            />
            {errors.interestRate && <span className={styles.error}>{errors.interestRate}</span>}
          </div>
          <div className={styles.field}>
            <label className={styles.label}>{isCard ? 'Minimum payment (€)' : 'Monthly payment (€)'}</label>
            <input
              type="number"
              inputMode="decimal"
              className={`${styles.input} ${errors.monthlyPayment ? styles.inputError : ''}`}
              value={form.monthlyPayment}
              onChange={set('monthlyPayment')}
              placeholder="e.g. 450"
              step="0.01"
              min="0"
            />
            {errors.monthlyPayment && <span className={styles.error}>{errors.monthlyPayment}</span>}
          </div>
        </div>

        {/* Start date */}
        <div className={styles.field}>
          <label className={styles.label}>Start date <span className={styles.optional}>(optional)</span></label>
          <input type="date" className={styles.input} value={form.startDate} onChange={set('startDate')} />
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

        {errors._submit && <span className={styles.error}>{errors._submit}</span>}

        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : (isCard ? 'Add credit card' : 'Add loan')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
