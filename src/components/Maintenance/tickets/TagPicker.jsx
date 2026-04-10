import { useState } from 'react';
import styles from './TagPicker.module.css';

// Parse a comma-separated tag string into an array
export function parseTags(str) {
  if (!str) return [];
  return str.split(',').map((s) => s.trim()).filter(Boolean);
}

// Join tag array back to comma-separated string
export function joinTags(arr) {
  return arr.join(', ');
}

export default function TagPicker({ label, value, onChange, presetTags, customTags = [], onAddTag }) {
  const [newTag, setNewTag] = useState('');
  const selected = parseTags(value);
  const allTags = [...new Set([...presetTags, ...customTags])];

  function toggle(tag) {
    const next = selected.includes(tag)
      ? selected.filter((t) => t !== tag)
      : [...selected, tag];
    onChange(joinTags(next));
  }

  function handleAdd() {
    const tag = newTag.trim();
    if (!tag) return;
    if (!allTags.includes(tag) && onAddTag) onAddTag(tag);
    if (!selected.includes(tag)) onChange(joinTags([...selected, tag]));
    setNewTag('');
  }

  return (
    <div className={styles.wrap}>
      {label && <span className={styles.label}>{label}</span>}
      <div className={styles.chipGrid}>
        {allTags.map((tag) => (
          <button
            key={tag}
            type="button"
            className={`${styles.chip} ${selected.includes(tag) ? styles.chipActive : ''}`}
            onClick={() => toggle(tag)}
          >
            {tag}
          </button>
        ))}
      </div>
      {selected.length > 0 && (
        <p className={styles.selected}>
          Selected: <strong>{selected.join(', ')}</strong>
        </p>
      )}
      <div className={styles.addRow}>
        <input
          className={styles.addInput}
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAdd())}
          placeholder="Add custom tag…"
        />
        <button type="button" className={styles.addBtn} onClick={handleAdd}>
          Add
        </button>
      </div>
    </div>
  );
}
