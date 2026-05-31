import { useState, useEffect } from 'react';
import Modal from '../Shared/Modal.jsx';
import Button from '../Shared/Button.jsx';
import { CATEGORIES, FREQUENCIES, CATEGORY_KEYS, FREQUENCY_KEYS } from '../../utils/constants.js';
import { formatEUR, todayISO } from '../../utils/formatters.js';
import { normalizeToMonthly } from '../../utils/calculations.js';
import { validate } from '../../utils/validateForm.js';
import { costSchema } from '../../utils/schemas/costSchema.js';
import styles from './CostFormModal.module.css';

const EMPTY = {
  name: '',
  category: 'fixed',
  amount: '',
  frequency: 'monthly',
  startDate: todayISO(),
  endDate: '',
  notes: '',
  location: '',
  // Loan-specific
  lenderName: '',
  principalAmount: '',
  interestRate: '',
  loanTermMonths: '',
  // Credit card-specific
  cardName: '',
  creditLimit: '',
  minimumPayment: '',
};

export default function CostFormModal({ isOpen, onClose, onSave, initialData, locations }) {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const isEdit = !!initialData;

  useEffect(() => {
    if (isOpen) {
      setForm(initialData ? { ...EMPTY, ...initialData, endDate: initialData.endDate || '' } : EMPTY);
      setErrors({});
      setSaving(false);
    }
  }, [isOpen, initialData]);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    // #364 — use shared schema validator instead of inline ad-hoc validation
    const { errors: errs } = validate(form, costSchema);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    try {
      await onSave({
        ...form,
        amount:         parseFloat(form.amount),
        endDate:        form.endDate        || null,
        location:       form.location       || null,
        // Loan fields
        lenderName:     form.lenderName     || null,
        principalAmount:form.principalAmount ? parseFloat(form.principalAmount) : null,
        interestRate:   form.interestRate   ? parseFloat(form.interestRate)     : null,
        loanTermMonths: form.loanTermMonths ? parseInt(form.loanTermMonths, 10) : null,
        // Credit card fields
        cardName:       form.cardName       || null,
        creditLimit:    form.creditLimit    ? parseFloat(form.creditLimit)      : null,
        minimumPayment: form.minimumPayment ? parseFloat(form.minimumPayment)   : null,
      });
      onClose();
    } catch (err) {
      setErrors((prev) => ({ ...prev, _submit: err.message }));
      setSaving(false);
    }
  };

  const preview = form.amount && !isNaN(Number(form.amount))
    ? normalizeToMonthly({ amount: Number(form.amount), frequency: form.frequency })
    : null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEdit ? 'Edit Cost' : 'Add Cost'} width={560}>
      <form onSubmit={handleSubmit} className={styles.form}>

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

        {/* Location (only when locations are configured) */}
        {locations?.length > 0 && (
          <div className={styles.field}>
            <label className={styles.label}>Location</label>
            <select className={styles.select} value={form.location} onChange={set('location')}>
              <option value="">All Locations (fleet-wide)</option>
              {locations.map((loc) => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>
          </div>
        )}

        {/* Amount */}
        <div className={styles.field}>
          <label className={styles.label}>Amount (EUR) *</label>
          <div className={styles.amountWrap}>
            <span className={styles.eurSymbol}>€</span>
            <input
              type="number"
              inputMode="decimal"
              className={`${styles.input} ${styles.amountInput} ${errors.amount ? styles.inputError : ''}`}
              value={form.amount}
              onChange={set('amount')}
              placeholder="0.00"
              step="0.01"
              min="0"
              max="999999999"
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
            <input type="date" className={`${styles.input} ${errors.endDate ? styles.inputError : ''}`} value={form.endDate} onChange={set('endDate')} />
            {errors.endDate && <span className={styles.error}>{errors.endDate}</span>}
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

        {/* Loan-specific fields */}
        {form.category === 'loan' && (
          <>
            <div className={styles.sectionDivider}>Loan Details</div>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Lender / Bank</label>
                <input className={styles.input} value={form.lenderName} onChange={set('lenderName')} placeholder="e.g. Alpha Bank" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Interest Rate (% / yr)</label>
                <input type="number" inputMode="decimal" className={styles.input} value={form.interestRate} onChange={set('interestRate')} placeholder="e.g. 5.5" step="0.01" min="0" />
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Original Principal (€)</label>
                <input type="number" inputMode="decimal" className={styles.input} value={form.principalAmount} onChange={set('principalAmount')} placeholder="e.g. 50000" step="0.01" min="0" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Loan Term (months)</label>
                <input type="number" inputMode="numeric" className={styles.input} value={form.loanTermMonths} onChange={set('loanTermMonths')} placeholder="e.g. 60" step="1" min="1" />
              </div>
            </div>
          </>
        )}

        {/* Credit card-specific fields */}
        {form.category === 'credit-card' && (
          <>
            <div className={styles.sectionDivider}>Credit Card Details</div>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Card / Bank Name</label>
                <input className={styles.input} value={form.cardName} onChange={set('cardName')} placeholder="e.g. Eurobank Visa" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Interest Rate / APR (%)</label>
                <input type="number" inputMode="decimal" className={styles.input} value={form.interestRate} onChange={set('interestRate')} placeholder="e.g. 18.5" step="0.01" min="0" />
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Credit Limit (€)</label>
                <input type="number" inputMode="decimal" className={styles.input} value={form.creditLimit} onChange={set('creditLimit')} placeholder="e.g. 10000" step="0.01" min="0" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Minimum Payment (€)</label>
                <input type="number" inputMode="decimal" className={styles.input} value={form.minimumPayment} onChange={set('minimumPayment')} placeholder="e.g. 250" step="0.01" min="0" />
              </div>
            </div>
          </>
        )}

        {/* Submit error */}
        {errors._submit && <span className={styles.error}>{errors._submit}</span>}

        {/* Actions */}
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Cost'}</Button>
        </div>
      </form>
    </Modal>
  );
}
