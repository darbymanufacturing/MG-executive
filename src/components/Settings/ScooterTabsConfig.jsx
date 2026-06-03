/**
 * ScooterTabsConfig — drag-to-reorder + enable/disable tabs for /scooters/:id
 * Lives in Settings → "Scooter Page" section.
 *
 * Drag-and-drop uses native HTML5 drag events (no framer-motion).
 */

import { useState, useEffect, useRef } from 'react';
import { GripVertical, Eye, EyeOff } from 'lucide-react';
import { useScooterConfig } from '../../context/ScooterConfigContext.jsx';
import { TAB_REGISTRY } from '../Scooters/tabRegistry.js';
import Button from '../Shared/Button.jsx';
import styles from './ScooterTabsConfig.module.css';

export default function ScooterTabsConfig() {
  const { tabs, saveTabs } = useScooterConfig();
  const [localTabs, setLocalTabs] = useState(() => [...tabs].sort((a, b) => a.order - b.order));
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const dragIdx  = useRef(null);
  const dragOver = useRef(null);

  // Sync with context when it changes (e.g. after a remote save or first non-empty load)
  useEffect(() => {
    setLocalTabs([...tabs].sort((a, b) => a.order - b.order));
  }, [tabs]);

  function handleDragStart(idx) { dragIdx.current = idx; }
  function handleDragEnter(idx) { dragOver.current = idx; }

  function handleDrop() {
    const from = dragIdx.current;
    const to   = dragOver.current;
    if (from === null || from === to) return;
    const copy = [...localTabs];
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);
    setLocalTabs(copy.map((t, i) => ({ ...t, order: i })));
    dragIdx.current  = null;
    dragOver.current = null;
  }

  function toggleEnabled(id) {
    setLocalTabs((prev) => prev.map((t) =>
      t.id === id ? { ...t, enabled: !t.enabled } : t,
    ));
  }

  async function handleSave() {
    setSaving(true);
    await saveTabs(localTabs);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.hint}>
        Drag to reorder tabs on the scooter detail page. Toggle the eye icon to show or hide a tab.
      </p>

      <div className={styles.list}>
        {localTabs.map((t, idx) => {
          const entry = TAB_REGISTRY[t.id];
          const Icon  = entry?.icon;
          return (
            <div
              key={t.id}
              className={`${styles.item} ${!t.enabled ? styles.disabled : ''}`}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragEnter={() => handleDragEnter(idx)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <span className={styles.grip}><GripVertical size={15} /></span>
              {Icon && <Icon size={14} className={styles.tabIcon} />}
              <span className={styles.tabLabel}>{entry?.label || t.id}</span>
              <button
                className={styles.toggleBtn}
                onClick={() => toggleEnabled(t.id)}
                title={t.enabled ? 'Hide tab' : 'Show tab'}
                aria-label={t.enabled ? 'Hide tab' : 'Show tab'}
              >
                {t.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
            </div>
          );
        })}
      </div>

      <div className={styles.footer}>
        <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}
