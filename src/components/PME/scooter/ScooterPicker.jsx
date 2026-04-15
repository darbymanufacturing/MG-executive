import { useState } from 'react';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import styles from './Scooter.module.css';

export default function ScooterPicker({ value, onChange }) {
  const { scooters } = useMaintenance();
  const [query, setQuery] = useState('');

  const filtered = scooters.filter((s) =>
    !query || s.scooterId?.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className={styles.picker}>
      <label className={styles.pickerLabel}>Select scooter</label>
      <div className={styles.pickerRow}>
        <input
          className={styles.pickerInput}
          placeholder="Search by ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className={styles.pickerSelect}
          value={value || ''}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">— Pick a scooter —</option>
          {filtered.map((s) => (
            <option key={s.scooterId} value={s.scooterId}>
              {s.scooterId} · {s.city} · {s.status}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
