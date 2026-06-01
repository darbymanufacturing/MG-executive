import { useState, useEffect, useRef } from 'react';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import Button from '../../Shared/Button.jsx';
import styles from './ConfigEditor.module.css';

export default function ConfigEditor() {
  const { config, updateConfig } = useMaintenance();

  const [rate, setRate] = useState('');
  const [maxActive, setMaxActive] = useState('');
  // Phase 2.5 F1 — contractor labour rate (€/hour) for repair pay.
  const [labourRate, setLabourRate] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  // #227: track dirty state so effect doesn't reset in-flight edits
  const dirtyRef = useRef(false);

  useEffect(() => {
    // #227: narrow to specific keys instead of whole config object, and skip if dirty
    if (!dirtyRef.current) {
      setRate(config.revenueRatePerDay ?? '');
      setMaxActive(config.maxActiveTickets ?? '');
      setLabourRate(config.labourRatePerHour ?? '');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.revenueRatePerDay, config.maxActiveTickets, config.labourRatePerHour]);

  async function handleSave() {
    // #228: guard against NaN before writing to Firestore
    if (!Number.isFinite(parseFloat(rate)) || !Number.isFinite(parseFloat(maxActive))
        || !Number.isFinite(parseFloat(labourRate))) {
      setError('Please enter valid numbers');
      return;
    }
    setError('');
    setSaving(true);
    setSaved(false);
    try {
      await updateConfig({
        revenueRatePerDay: parseFloat(rate),
        maxActiveTickets: parseInt(maxActive, 10),
        labourRatePerHour: parseFloat(labourRate),
      });
      dirtyRef.current = false; // #227: reset after successful save
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    parseFloat(rate) !== config.revenueRatePerDay ||
    parseInt(maxActive, 10) !== config.maxActiveTickets ||
    parseFloat(labourRate) !== config.labourRatePerHour;

  return (
    <div className={styles.card}>
      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label}>Revenue Rate (€ / day)</label>
          <div className={styles.inputWrap}>
            <span className={styles.prefix}>€</span>
            <input
              className={styles.input}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={rate}
              onChange={(e) => { dirtyRef.current = true; setRate(e.target.value); }}
            />
          </div>
          <span className={styles.hint}>
            Current effective value: €{Number(config.revenueRatePerDay).toFixed(2)}/day
          </span>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Max Active Tickets</label>
          <input
            className={styles.input}
            type="number"
            inputMode="numeric"
            min="1"
            max="10"
            step="1"
            value={maxActive}
            onChange={(e) => { dirtyRef.current = true; setMaxActive(e.target.value); }}
          />
          <span className={styles.hint}>
            Current effective value: {config.maxActiveTickets} tickets
          </span>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Contractor Labour Rate (€ / hour)</label>
          <div className={styles.inputWrap}>
            <span className={styles.prefix}>€</span>
            <input
              className={styles.input}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.50"
              value={labourRate}
              onChange={(e) => { dirtyRef.current = true; setLabourRate(e.target.value); }}
            />
          </div>
          <span className={styles.hint}>
            Repair pay = procedure estimate × this rate. Current: €{Number(config.labourRatePerHour ?? 0).toFixed(2)}/hr
          </span>
        </div>
      </div>

      <div className={styles.footer}>
        {error && <span className={styles.errorMsg} style={{ color: 'var(--status-red)', fontSize: 13 }}>{error}</span>}
        {saved && <span className={styles.savedMsg}>Saved successfully</span>}
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={saving || !dirty}
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}
