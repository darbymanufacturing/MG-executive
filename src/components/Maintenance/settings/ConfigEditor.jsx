import { useState, useEffect } from 'react';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import Button from '../../Shared/Button.jsx';
import styles from './ConfigEditor.module.css';

export default function ConfigEditor() {
  const { config, updateConfig } = useMaintenance();

  const [rate, setRate] = useState('');
  const [maxActive, setMaxActive] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setRate(config.revenueRatePerDay ?? '');
    setMaxActive(config.maxActiveTickets ?? '');
  }, [config]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await updateConfig({
        revenueRatePerDay: parseFloat(rate),
        maxActiveTickets: parseInt(maxActive, 10),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    parseFloat(rate) !== config.revenueRatePerDay ||
    parseInt(maxActive, 10) !== config.maxActiveTickets;

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
              min="0"
              step="0.01"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
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
            min="1"
            max="10"
            step="1"
            value={maxActive}
            onChange={(e) => setMaxActive(e.target.value)}
          />
          <span className={styles.hint}>
            Current effective value: {config.maxActiveTickets} tickets
          </span>
        </div>
      </div>

      <div className={styles.footer}>
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
