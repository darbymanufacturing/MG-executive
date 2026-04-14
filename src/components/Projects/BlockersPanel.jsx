import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useProjects } from '../../context/ProjectContext.jsx';
import { BLOCKER_TYPES } from './constants.js';
import styles from './BlockersPanel.module.css';
import sharedStyles from './Projects.module.css';

export default function BlockersPanel({ project }) {
  const { addBlocker, resolveBlocker, deleteBlocker } = useProjects();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ text: '', type: 'internal', escalation: '' });

  const blockers = project.blockers || [];
  const active = blockers.filter((b) => !b.resolved);
  const resolved = blockers.filter((b) => b.resolved);

  async function handleAdd(e) {
    e.preventDefault();
    if (!form.text.trim()) return;
    await addBlocker(project._docId, { ...form, text: form.text.trim() });
    setForm({ text: '', type: 'internal', escalation: '' });
    setShowForm(false);
  }

  return (
    <div className={styles.panel}>
      {active.length === 0 && !showForm ? (
        <p className={sharedStyles.empty}>No active blockers — all clear.</p>
      ) : (
        <ul className={styles.list}>
          {active.map((b) => {
            const cfg = BLOCKER_TYPES[b.type] || BLOCKER_TYPES.internal;
            return (
              <li key={b.id} className={styles.item}>
                <div className={styles.itemHeader}>
                  <span className={styles.typeDot}>{cfg.dot}</span>
                  <span className={styles.typeLabel} style={{ color: cfg.color }}>{cfg.label}</span>
                  <span className={styles.blockerText}>{b.text}</span>
                </div>
                {b.escalation && (
                  <p className={styles.escalation}>Escalation: {b.escalation}</p>
                )}
                <div className={styles.itemMeta}>
                  {b.addedAt && <span className={styles.addedAt}>Added: {b.addedAt}</span>}
                  <button className={styles.resolveBtn} onClick={() => resolveBlocker(project._docId, b.id)}>
                    ✓ Mark Resolved
                  </button>
                  <button className={styles.deleteBtn} onClick={() => deleteBlocker(project._docId, b.id)}>
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {showForm ? (
        <form className={styles.addForm} onSubmit={handleAdd}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <select
              className={sharedStyles.select}
              style={{ flex: '0 0 150px' }}
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            >
              {Object.entries(BLOCKER_TYPES).map(([k, v]) => (
                <option key={k} value={k}>{v.dot} {v.label}</option>
              ))}
            </select>
            <input
              className={sharedStyles.input}
              style={{ flex: 1 }}
              placeholder="Describe the blocker…"
              value={form.text}
              onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
              autoFocus
              required
            />
          </div>
          <input
            className={sharedStyles.input}
            placeholder="Escalation path (optional) — e.g. Contact Giorgos by Apr 18"
            value={form.escalation}
            onChange={(e) => setForm((f) => ({ ...f, escalation: e.target.value }))}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className={sharedStyles.btnGhost} onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className={sharedStyles.btnPrimary}>Add Blocker</button>
          </div>
        </form>
      ) : (
        <button className={styles.addBtn} onClick={() => setShowForm(true)}>
          <Plus size={14} /> Add Blocker
        </button>
      )}

      {resolved.length > 0 && (
        <details className={styles.resolvedSection}>
          <summary className={styles.resolvedSummary}>
            {resolved.length} resolved blocker{resolved.length > 1 ? 's' : ''}
          </summary>
          <ul className={styles.list} style={{ marginTop: 8 }}>
            {resolved.map((b) => {
              const cfg = BLOCKER_TYPES[b.type] || BLOCKER_TYPES.internal;
              return (
                <li key={b.id} className={`${styles.item} ${styles.resolved}`}>
                  <span className={styles.typeDot}>{cfg.dot}</span>
                  <span className={styles.blockerText} style={{ textDecoration: 'line-through', opacity: 0.5 }}>
                    {b.text}
                  </span>
                  {b.resolvedAt && <span className={styles.addedAt}>Resolved: {b.resolvedAt}</span>}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
