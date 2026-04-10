import { useState, useEffect } from 'react';
import Modal from '../../Shared/Modal.jsx';
import Button from '../../Shared/Button.jsx';
import styles from './PartForm.module.css';

const STATUS_OPTIONS = ['In Stock', 'Low Stock', 'Out of Stock', 'On Order', 'Discontinued'];
const MODEL_OPTIONS = ['Shared', 'ES400B 2022', 'ES400B 2023'];

const EMPTY = {
  sku: '',
  partName: '',
  unitCost: '',
  leadTime: '',
  stockOnHand: '',
  reorderPoint: '',
  unitsOnOrder: 0,
  orderDate: '',
  eta: '',
  supplier: '',
  status: 'In Stock',
  model: 'Shared',
  notes: '',
};

function suggestStatus(stockOnHand, reorderPoint) {
  const stock = parseInt(stockOnHand, 10);
  const reorder = parseInt(reorderPoint, 10);
  if (isNaN(stock)) return null;
  if (stock === 0) return 'Out of Stock';
  if (!isNaN(reorder) && stock <= reorder) return 'Low Stock';
  return 'In Stock';
}

export default function PartForm({ isOpen, onClose, onSave, initialData }) {
  const isEdit = !!initialData;
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [statusSuggestion, setStatusSuggestion] = useState(null);

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setForm({
          sku: initialData.sku ?? '',
          partName: initialData.partName ?? '',
          unitCost: initialData.unitCost ?? '',
          leadTime: initialData.leadTime ?? '',
          stockOnHand: initialData.stockOnHand ?? '',
          reorderPoint: initialData.reorderPoint ?? '',
          unitsOnOrder: initialData.unitsOnOrder ?? 0,
          orderDate: initialData.orderDate ?? '',
          eta: initialData.eta ?? '',
          supplier: initialData.supplier ?? '',
          status: initialData.status ?? 'In Stock',
          model: initialData.model ?? 'Shared',
          notes: initialData.notes ?? '',
        });
      } else {
        setForm(EMPTY);
      }
      setErrors({});
      setStatusSuggestion(null);
    }
  }, [isOpen, initialData]);

  function set(key, value) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'stockOnHand' || key === 'reorderPoint') {
        const suggestion = suggestStatus(
          key === 'stockOnHand' ? value : prev.stockOnHand,
          key === 'reorderPoint' ? value : prev.reorderPoint
        );
        setStatusSuggestion(suggestion);
      }
      return next;
    });
    if (errors[key]) setErrors((e) => ({ ...e, [key]: null }));
  }

  function validate() {
    const errs = {};
    if (!form.sku.trim()) errs.sku = 'SKU is required';
    if (!form.partName.trim()) errs.partName = 'Part name is required';
    return errs;
  }

  function handleSave() {
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    onSave({
      sku: form.sku.trim(),
      partName: form.partName.trim(),
      unitCost: form.unitCost === '' ? 0 : parseFloat(form.unitCost),
      leadTime: form.leadTime === '' ? 0 : parseInt(form.leadTime, 10),
      stockOnHand: form.stockOnHand === '' ? 0 : parseInt(form.stockOnHand, 10),
      reorderPoint: form.reorderPoint === '' ? 0 : parseInt(form.reorderPoint, 10),
      unitsOnOrder: form.unitsOnOrder === '' ? 0 : parseInt(form.unitsOnOrder, 10),
      orderDate: form.orderDate || null,
      eta: form.eta || null,
      supplier: form.supplier.trim() || null,
      status: form.status,
      model: form.model,
      notes: form.notes.trim() || null,
    });
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? `Edit Part — ${initialData?.sku}` : 'Add New Part'}
    >
      <div className={styles.form}>
        {/* Row 1: SKU + Part Name */}
        <div className={styles.grid2}>
          <div className={styles.field}>
            <label className={styles.label}>
              SKU <span className={styles.req}>*</span>
            </label>
            <input
              className={`${styles.input} ${errors.sku ? styles.inputError : ''}`}
              value={form.sku}
              onChange={(e) => set('sku', e.target.value)}
              readOnly={isEdit}
              placeholder="e.g. BRK-001"
            />
            {errors.sku && <span className={styles.error}>{errors.sku}</span>}
          </div>
          <div className={styles.field}>
            <label className={styles.label}>
              Part Name <span className={styles.req}>*</span>
            </label>
            <input
              className={`${styles.input} ${errors.partName ? styles.inputError : ''}`}
              value={form.partName}
              onChange={(e) => set('partName', e.target.value)}
              placeholder="e.g. Brake Cable"
            />
            {errors.partName && <span className={styles.error}>{errors.partName}</span>}
          </div>
        </div>

        {/* Row 2: Unit Cost + Lead Time */}
        <div className={styles.grid2}>
          <div className={styles.field}>
            <label className={styles.label}>Unit Cost (€)</label>
            <input
              className={styles.input}
              type="number"
              min="0"
              step="0.01"
              value={form.unitCost}
              onChange={(e) => set('unitCost', e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Lead Time (days)</label>
            <input
              className={styles.input}
              type="number"
              min="0"
              step="1"
              value={form.leadTime}
              onChange={(e) => set('leadTime', e.target.value)}
              placeholder="0"
            />
          </div>
        </div>

        {/* Row 3: Stock on Hand + Reorder Point */}
        <div className={styles.grid2}>
          <div className={styles.field}>
            <label className={styles.label}>Stock on Hand</label>
            <input
              className={styles.input}
              type="number"
              min="0"
              step="1"
              value={form.stockOnHand}
              onChange={(e) => set('stockOnHand', e.target.value)}
              placeholder="0"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Reorder Point</label>
            <input
              className={styles.input}
              type="number"
              min="0"
              step="1"
              value={form.reorderPoint}
              onChange={(e) => set('reorderPoint', e.target.value)}
              placeholder="0"
            />
            <span className={styles.hint}>Low stock alert triggers when &le; reorder point</span>
          </div>
        </div>

        {/* Row 4: Units on Order + Order Date */}
        <div className={styles.grid2}>
          <div className={styles.field}>
            <label className={styles.label}>Units on Order</label>
            <input
              className={styles.input}
              type="number"
              min="0"
              step="1"
              value={form.unitsOnOrder}
              onChange={(e) => set('unitsOnOrder', e.target.value)}
              placeholder="0"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Order Date</label>
            <input
              className={styles.input}
              type="date"
              value={form.orderDate}
              onChange={(e) => set('orderDate', e.target.value)}
            />
          </div>
        </div>

        {/* Row 5: ETA + Supplier */}
        <div className={styles.grid2}>
          <div className={styles.field}>
            <label className={styles.label}>ETA</label>
            <input
              className={styles.input}
              type="date"
              value={form.eta}
              onChange={(e) => set('eta', e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Supplier</label>
            <input
              className={styles.input}
              type="text"
              value={form.supplier}
              onChange={(e) => set('supplier', e.target.value)}
              placeholder="Supplier name"
            />
          </div>
        </div>

        {/* Row 6: Model + Status */}
        <div className={styles.grid2}>
          <div className={styles.field}>
            <label className={styles.label}>Model</label>
            <select
              className={styles.select}
              value={form.model}
              onChange={(e) => set('model', e.target.value)}
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Status</label>
          <div className={styles.statusRow}>
            <select
              className={styles.select}
              value={form.status}
              onChange={(e) => set('status', e.target.value)}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {statusSuggestion && statusSuggestion !== form.status && (
              <button
                type="button"
                className={styles.suggestBtn}
                onClick={() => {
                  set('status', statusSuggestion);
                  setStatusSuggestion(null);
                }}
              >
                Suggest: {statusSuggestion}
              </button>
            )}
          </div>
          </div>
        </div>

        {/* Notes */}
        <div className={styles.field}>
          <label className={styles.label}>Notes</label>
          <textarea
            className={styles.textarea}
            rows={3}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Optional notes…"
          />
        </div>

        <div className={styles.actions}>
          <Button variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={handleSave}>
            {isEdit ? 'Save Changes' : 'Add Part'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
