import { useState, useEffect, useMemo } from 'react';
import Modal from '../Shared/Modal.jsx';
import Button from '../Shared/Button.jsx';
import { CATEGORIES, FREQUENCIES, CATEGORY_KEYS, FREQUENCY_KEYS } from '../../utils/constants.js';
import { formatEUR, todayISO } from '../../utils/formatters.js';
import { normalizeToMonthly } from '../../utils/calculations.js';
import { validate } from '../../utils/validateForm.js';
import { costSchema } from '../../utils/schemas/costSchema.js';
import { useFleet } from '../../context/FleetContext.jsx';
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
  fleetId: '', // FF-3 — which fleet's P&L this cost hits ('' = company-wide overhead)
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
  // Edit mode only when the initial data is an EXISTING cost (has an id) — a
  // partial prefill (e.g. the Planner's "+ Add" with category/date preset) is a create.
  const isEdit = !!initialData?.id;
  const { fleets, activeFleet } = useFleet(); // FF-3 — per-cost fleet scope

  useEffect(() => {
    if (isOpen) {
      // New costs default their fleet scope to the active fleet (else company-wide).
      setForm(initialData
        ? { ...EMPTY, ...initialData, endDate: initialData.endDate || '' }
        : { ...EMPTY, fleetId: activeFleet?._docId ?? '' });
      setErrors({});
      setSaving(false);
    }
  }, [isOpen, initialData]);

  // #564 — derive which locations are valid for the currently-selected fleet.
  // When a fleet is chosen, only its configured cities are valid location options;
  // when no fleet is chosen (company-wide overhead), all locations remain available.
  const allowedLocations = useMemo(() => {
    if (!form.fleetId || !fleets.length) return locations ?? [];
    const selectedFleet = fleets.find((f) => f._docId === form.fleetId);
    if (!selectedFleet?.cities?.length) return locations ?? [];
    // Intersect fleet.cities with the prop-provided locations list so we never
    // surface a city that has no cost-location mapping in the parent component.
    const fleetCitySet = new Set((selectedFleet.cities).map((c) => String(c).toLowerCase()));
    return (locations ?? []).filter((loc) => fleetCitySet.has(String(loc).toLowerCase()));
  }, [form.fleetId, fleets, locations]);

  // #564 — when the fleet changes, clear location if it is no longer in allowedLocations.
  // This prevents a stale location from persisting and causing double-counting in FleetPnl.
  useEffect(() => {
    if (!form.location) return;
    const stillValid = allowedLocations.some(
      (loc) => String(loc).toLowerCase() === String(form.location).toLowerCase()
    );
    if (!stillValid) {
      setForm((f) => ({ ...f, location: '' }));
    }
  }, [form.fleetId]); // intentionally only re-run when fleetId changes

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
        fleetId:        form.fleetId        || null,
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

        {/* Location — filtered to the selected fleet's cities to prevent cross-fleet mismatch (#564) */}
        {locations?.length > 0 && (
          <div className={styles.field}>
            <label className={styles.label}>
              Location
              {form.fleetId && allowedLocations.length < (locations?.length ?? 0) && (
                <span className={styles.optional}> (filtered to fleet)</span>
              )}
            </label>
            <select className={styles.select} value={form.location} onChange={set('location')}>
              <option value="">All Locations (fleet-wide)</option>
              {allowedLocations.map((loc) => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>
            {form.fleetId && allowedLocations.length === 0 && (
              <span className={styles.error}>
                No locations configured for this fleet — add cities in Fleet Settings.
              </span>
            )}
          </div>
        )}

        {/* FF-3 — which fleet's P&L this cost belongs to (or company-wide overhead) */}
        {fleets.length > 0 && (
          <div className={styles.field}>
            <label className={styles.label}>Applies to</label>
            <select className={styles.select} value={form.fleetId} onChange={set('fleetId')}>
              <option value="">Whole company (shared overhead)</option>
              {fleets.map((f) => (
                <option key={f._docId} value={f._docId}>{f.name}</option>
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
