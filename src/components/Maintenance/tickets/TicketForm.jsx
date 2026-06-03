import { useState, useEffect } from 'react';
import Modal from '../../Shared/Modal.jsx';
import Button from '../../Shared/Button.jsx';
import TagPicker from './TagPicker.jsx';
import { useCosts } from '../../../context/CostContext.jsx';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import styles from './TicketForm.module.css';

const PRIMARY_TAGS = [
  'Loose Neck', 'Brake Lines', 'IoT', 'Motor/Tire', 'Throttle', 'Inspection',
  'Tooling Required', 'Unknown Process', 'Front Fork', 'Bearing Cap',
  'Twisted Neck', 'Handlebar Centering', 'Headlight', 'Kickstand', 'Bolts',
];

const SECONDARY_TAGS = [
  'Routine Maintenance', 'Parts Required', 'Bolt Extractor Kit Required', 'Donor',
];

const CATEGORIES = { Q: 'Quick (<2hr)', M: 'Medium/Estimated', C: 'Complex', B: 'Blocked', F: 'Finished' };
const STATUSES   = ['Active', 'Backlog', 'Investigation', 'Blocked', 'Donor', 'Completed'];

function blank() {
  return {
    scooterId:        '',
    city:             'Corinth',
    dateEntered:      new Date().toISOString().slice(0, 10),
    category:         'B',
    status:           'Backlog',
    primaryTag:       PRIMARY_TAGS[0],
    secondaryTag:     '',
    dateCompleted:    '',
    issueDescription: '',
    notes:            '',
  };
}

export default function TicketForm({ isOpen, onClose, onSave, initialData, isAtMaxActive }) {
  const { config } = useCosts();
  const { config: mConfig, addCustomTag } = useMaintenance();
  const cities = config.locations?.length ? config.locations : ['Corinth', 'Nafplio'];

  const [form,   setForm]   = useState(blank());
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  // Populate when editing
  useEffect(() => {
    if (isOpen) {
      setForm(initialData ? { ...blank(), ...initialData } : blank());
      setErrors({});
      setSaving(false);
    }
  }, [isOpen, initialData]);

  function set(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function validate() {
    const e = {};
    if (!form.scooterId.trim())        e.scooterId        = 'Required';
    if (!form.city)                    e.city             = 'Required';
    if (!form.dateEntered)             e.dateEntered      = 'Required';
    if (!form.category)                e.category         = 'Required';
    if (!form.status)                  e.status           = 'Required';
    if (!form.primaryTag)              e.primaryTag       = 'Required';
    if (!form.issueDescription.trim()) e.issueDescription = 'Required';
    return e;
  }

  async function handleSave() {
    const e = validate();
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    setSaving(true);
    const payload = { ...form };
    if (payload.status !== 'Completed') delete payload.dateCompleted;
    if (!payload.secondaryTag) delete payload.secondaryTag;
    if (!payload.notes)        delete payload.notes;
    try {
      await onSave(payload);
      onClose();
    } catch (err) {
      setErrors((prev) => ({ ...prev, _submit: err.message }));
    } finally {
      setSaving(false);
    }
  }

  const originalStatus    = initialData?.status ?? '';
  const showActiveWarning = form.status === 'Active' && isAtMaxActive && originalStatus !== 'Active';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialData ? `Edit Ticket — ${initialData.scooterId ?? ''}` : 'Add Repair Ticket'}
      width="680px"
    >
      <div className={styles.form}>
        <div className={styles.grid2}>
          {/* Scooter ID */}
          <div className={styles.field}>
            <label className={styles.label}>Scooter ID <span className={styles.req}>*</span></label>
            <input
              className={`${styles.input} ${errors.scooterId ? styles.inputError : ''}`}
              type="text"
              placeholder="e.g. XS-1042"
              value={form.scooterId}
              onChange={(e) => set('scooterId', e.target.value)}
            />
            {errors.scooterId && <span className={styles.errorMsg}>{errors.scooterId}</span>}
          </div>

          {/* City */}
          <div className={styles.field}>
            <label className={styles.label}>City <span className={styles.req}>*</span></label>
            <select
              className={`${styles.select} ${errors.city ? styles.inputError : ''}`}
              value={form.city}
              onChange={(e) => set('city', e.target.value)}
            >
              {cities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {errors.city && <span className={styles.errorMsg}>{errors.city}</span>}
          </div>

          {/* Date Entered */}
          <div className={styles.field}>
            <label className={styles.label}>Date Entered <span className={styles.req}>*</span></label>
            <input
              className={`${styles.input} ${errors.dateEntered ? styles.inputError : ''}`}
              type="date"
              value={form.dateEntered}
              onChange={(e) => set('dateEntered', e.target.value)}
            />
            {errors.dateEntered && <span className={styles.errorMsg}>{errors.dateEntered}</span>}
          </div>

          {/* Category */}
          <div className={styles.field}>
            <label className={styles.label}>Category <span className={styles.req}>*</span></label>
            <select
              className={`${styles.select} ${errors.category ? styles.inputError : ''}`}
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
            >
              {Object.entries(CATEGORIES).map(([code, label]) => (
                <option key={code} value={code}>{code} — {label}</option>
              ))}
            </select>
            {errors.category && <span className={styles.errorMsg}>{errors.category}</span>}
          </div>

          {/* Status */}
          <div className={styles.field}>
            <label className={styles.label}>Status <span className={styles.req}>*</span></label>
            <select
              className={`${styles.select} ${errors.status ? styles.inputError : ''}`}
              value={form.status}
              onChange={(e) => set('status', e.target.value)}
            >
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {errors.status && <span className={styles.errorMsg}>{errors.status}</span>}
            {showActiveWarning && (
              <span className={styles.activeWarning}>
                ⚠ {initialData ? initialData.scooterId ?? '' : ''} — 3 active tickets already — adding more is not recommended.
              </span>
            )}
          </div>

          {/* Primary Tags */}
          <div className={`${styles.field} ${styles.fullWidth}`}>
            <label className={styles.label}>Primary Tags <span className={styles.req}>*</span></label>
            <TagPicker
              value={form.primaryTag}
              onChange={(v) => set('primaryTag', v)}
              presetTags={PRIMARY_TAGS}
              customTags={mConfig.customPrimaryTags || []}
              onAddTag={(tag) => addCustomTag('primary', tag)}
            />
            {errors.primaryTag && <span className={styles.errorMsg}>{errors.primaryTag}</span>}
          </div>

          {/* Secondary Tags */}
          <div className={`${styles.field} ${styles.fullWidth}`}>
            <label className={styles.label}>Secondary Tags</label>
            <TagPicker
              value={form.secondaryTag}
              onChange={(v) => set('secondaryTag', v)}
              presetTags={SECONDARY_TAGS}
              customTags={mConfig.customSecondaryTags || []}
              onAddTag={(tag) => addCustomTag('secondary', tag)}
            />
          </div>

          {/* Date Completed — only when status is Completed */}
          {form.status === 'Completed' && (
            <div className={styles.field}>
              <label className={styles.label}>Date Completed</label>
              <input
                className={styles.input}
                type="date"
                value={form.dateCompleted}
                onChange={(e) => set('dateCompleted', e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Issue Description — full width */}
        <div className={styles.field}>
          <label className={styles.label}>Issue Description <span className={styles.req}>*</span></label>
          <textarea
            className={`${styles.textarea} ${errors.issueDescription ? styles.inputError : ''}`}
            rows={3}
            placeholder="Describe the issue clearly…"
            value={form.issueDescription}
            onChange={(e) => set('issueDescription', e.target.value)}
          />
          {errors.issueDescription && <span className={styles.errorMsg}>{errors.issueDescription}</span>}
        </div>

        {/* Notes — full width */}
        <div className={styles.field}>
          <label className={styles.label}>Notes</label>
          <textarea
            className={styles.textarea}
            rows={2}
            placeholder="Optional internal notes…"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </div>

        {/* Submit error */}
        {errors._submit && <p style={{ color: 'var(--color-danger)', fontSize: 'var(--text-sm)', margin: '4px 0 0' }}>{errors._submit}</p>}

        {/* Actions */}
        <div className={styles.actions}>
          <Button variant="secondary" size="md" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : initialData ? 'Save Changes' : 'Add Ticket'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
