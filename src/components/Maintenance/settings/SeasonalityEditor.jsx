import { useState, useEffect, useRef } from 'react';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import Button from '../../Shared/Button.jsx';
import styles from './SeasonalityEditor.module.css';

// #225: normalize European decimal commas before parsing
function safeParseFloat(value) {
  return parseFloat(String(value).replace(',', '.'));
}

const MONTHS = [
  { key: 'jan', label: 'January' },
  { key: 'feb', label: 'February' },
  { key: 'mar', label: 'March' },
  { key: 'apr', label: 'April' },
  { key: 'may', label: 'May' },
  { key: 'jun', label: 'June' },
  { key: 'jul', label: 'July' },
  { key: 'aug', label: 'August' },
  { key: 'sep', label: 'September' },
  { key: 'oct', label: 'October' },
  { key: 'nov', label: 'November' },
  { key: 'dec', label: 'December' },
];

export default function SeasonalityEditor() {
  const { config, updateConfig } = useMaintenance();

  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // #224: track whether user has made in-flight edits; don't overwrite from effect
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (config.seasonalityIndex) {
      // #224: only sync from config when not currently dirty (user hasn't started editing)
      if (!dirtyRef.current) {
        const init = {};
        MONTHS.forEach(({ key }) => {
          init[key] = config.seasonalityIndex[key] ?? '';
        });
        setValues(init);
      }
    }
  }, [config.seasonalityIndex]);

  function handleChange(key, val) {
    dirtyRef.current = true; // #224: mark dirty so effect won't overwrite
    setValues((prev) => ({ ...prev, [key]: val }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const seasonalityIndex = {};
      MONTHS.forEach(({ key }) => {
        // #225: use safeParseFloat to handle European decimal commas
        seasonalityIndex[key] = safeParseFloat(values[key]) || 0;
      });
      await updateConfig({ seasonalityIndex });
      dirtyRef.current = false; // #224: reset dirty after successful save
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  // #226: use epsilon comparison for floats instead of strict !==
  const isDirty = MONTHS.some(({ key }) => {
    const current = config.seasonalityIndex?.[key] ?? 0;
    const local = safeParseFloat(values[key]);
    return !isNaN(local) && Math.abs(local - current) > 1e-6;
  });

  return (
    <div className={styles.card}>
      <p className={styles.description}>
        Each value represents the average daily revenue (€) for that month, used to weight revenue
        loss calculations by season.
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Month</th>
            <th className={styles.right}>€ / day</th>
            <th className={styles.right}>Saved value</th>
          </tr>
        </thead>
        <tbody>
          {MONTHS.map(({ key, label }) => (
            <tr key={key}>
              <td className={styles.monthLabel}>{label}</td>
              <td className={styles.right}>
                <input
                  className={styles.input}
                  type="number"
                  min="0"
                  step="0.01"
                  value={values[key] ?? ''}
                  onChange={(e) => handleChange(key, e.target.value)}
                />
              </td>
              <td className={`${styles.right} ${styles.savedVal}`}>
                €{Number(config.seasonalityIndex?.[key] ?? 0).toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={styles.footer}>
        {saved && <span className={styles.savedMsg}>Saved successfully</span>}
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={saving || !isDirty}
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}
