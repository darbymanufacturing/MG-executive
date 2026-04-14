import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useProjects } from '../../context/ProjectContext.jsx';
import { OWNERS } from './constants.js';
import styles from './DecisionLog.module.css';
import sharedStyles from './Projects.module.css';

export default function DecisionLog({ project }) {
  const { addDecision } = useProjects();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: '',
    decision: '',
    why: '',
    madeBy: project.owner || 'Kostas',
    alternatives: '',
  });
  const [saving, setSaving] = useState(false);

  const decisions = project.decisions || [];

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.decision.trim()) return;
    setSaving(true);
    await addDecision(project._docId, form);
    setForm({ title: '', decision: '', why: '', madeBy: project.owner || 'Kostas', alternatives: '' });
    setShowForm(false);
    setSaving(false);
  }

  return (
    <div className={styles.container}>
      {decisions.length === 0 && !showForm && (
        <p className={sharedStyles.empty}>No decisions logged yet.</p>
      )}

      <ul className={styles.list}>
        {decisions.map((d) => (
          <li key={d.id} className={styles.entry}>
            <div className={styles.entryHeader}>
              <span className={styles.date}>{d.date}</span>
              <strong className={styles.title}>{d.title.toUpperCase()}</strong>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Decision:</span>
              <span className={styles.fieldValue}>{d.decision}</span>
            </div>
            {d.why && (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Why:</span>
                <span className={styles.fieldValue}>{d.why}</span>
              </div>
            )}
            <div className={styles.fieldRow}>
              {d.madeBy && (
                <span className={styles.badge}>By: {d.madeBy}</span>
              )}
              {d.alternatives && (
                <div className={styles.field} style={{ flex: 1 }}>
                  <span className={styles.fieldLabel}>Alternatives considered:</span>
                  <span className={styles.fieldValue}>{d.alternatives}</span>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      {showForm ? (
        <form className={styles.form} onSubmit={handleSubmit}>
          <input
            className={sharedStyles.input}
            placeholder="Decision title * — e.g. CORFU CANCELLED"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            required
            autoFocus
          />
          <textarea
            className={sharedStyles.input}
            placeholder="What was decided? *"
            value={form.decision}
            onChange={(e) => setForm((f) => ({ ...f, decision: e.target.value }))}
            rows={2}
            required
            style={{ resize: 'vertical' }}
          />
          <textarea
            className={sharedStyles.input}
            placeholder="Why? — reasoning, constraints, data that led to this"
            value={form.why}
            onChange={(e) => setForm((f) => ({ ...f, why: e.target.value }))}
            rows={2}
            style={{ resize: 'vertical' }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>
                Made by
              </label>
              <select
                className={sharedStyles.select}
                value={form.madeBy}
                onChange={(e) => setForm((f) => ({ ...f, madeBy: e.target.value }))}
              >
                {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
                <option value="Kostas + Panos">Kostas + Panos</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>
                Alternatives considered
              </label>
              <input
                className={sharedStyles.input}
                placeholder="e.g. Partial launch, delayed launch"
                value={form.alternatives}
                onChange={(e) => setForm((f) => ({ ...f, alternatives: e.target.value }))}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className={sharedStyles.btnGhost} onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className={sharedStyles.btnPrimary} disabled={saving}>
              {saving ? 'Saving…' : 'Log Decision'}
            </button>
          </div>
        </form>
      ) : (
        <button className={styles.addBtn} onClick={() => setShowForm(true)}>
          <Plus size={14} /> Log Decision
        </button>
      )}
    </div>
  );
}
