import { useState, useEffect } from 'react';
import { useProjects } from '../../context/ProjectContext.jsx';
import { OWNERS } from './constants.js';
import styles from './NextActionPanel.module.css';

export default function NextActionPanel({ project }) {
  const { setNextAction, completeNextAction } = useProjects();
  const [editing, setEditing] = useState(!project.nextAction);
  const [form, setForm] = useState({
    text: project.nextAction?.text || '',
    dueDate: project.nextAction?.dueDate || '',
    owner: project.nextAction?.owner || project.owner || 'Kostas',
  });
  // After completing, prompt for the next one
  const [promptNext, setPromptNext] = useState(false);

  // When nextAction gets set externally, exit editing mode (#238)
  useEffect(() => {
    if (project.nextAction && editing) setEditing(false);
  }, [project.nextAction]);

  async function handleSave(e) {
    e.preventDefault();
    if (!form.text.trim()) return;
    await setNextAction(project._docId, { ...form, text: form.text.trim() });
    setEditing(false);
    setPromptNext(false);
  }

  async function handleComplete() {
    try {
      await completeNextAction(project._docId);
      setForm({ text: '', dueDate: '', owner: project.owner || 'Kostas' });
      setEditing(true);
      setPromptNext(true);
    } catch (err) {
      console.error('Failed to complete next action:', err);
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.label}>NEXT ACTION</div>

      {editing ? (
        <form className={styles.form} onSubmit={handleSave}>
          {promptNext && (
            <p className={styles.promptText}>
              ✓ Done — what&rsquo;s the next action?
            </p>
          )}
          <input
            className={styles.textInput}
            value={form.text}
            onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
            placeholder="Single sentence. What moves this forward this week?"
            autoFocus
            required
          />
          <div className={styles.metaRow}>
            <div className={styles.metaField}>
              <label className={styles.metaLabel}>Due</label>
              <input
                type="date"
                className={styles.metaInput}
                value={form.dueDate}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
              />
            </div>
            <div className={styles.metaField}>
              <label className={styles.metaLabel}>Owner</label>
              <select
                className={styles.metaInput}
                value={form.owner}
                onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}
              >
                {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <button type="submit" className={styles.saveBtn}>Save</button>
            {project.nextAction && (
              <button type="button" className={styles.cancelBtn} onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className={styles.display}>
          <p className={styles.actionText}>{project.nextAction?.text}</p>
          <div className={styles.displayMeta}>
            {project.nextAction?.dueDate && (
              <span className={styles.duePill}>Due: {project.nextAction.dueDate}</span>
            )}
            {project.nextAction?.owner && (
              <span className={styles.ownerPill}>{project.nextAction.owner}</span>
            )}
          </div>
          <div className={styles.displayActions}>
            <button className={styles.editBtn} onClick={() => {
              setForm({
                text: project.nextAction?.text || '',
                dueDate: project.nextAction?.dueDate || '',
                owner: project.nextAction?.owner || 'Kostas',
              });
              setEditing(true);
            }}>
              Edit
            </button>
            <button className={styles.doneBtn} onClick={handleComplete}>
              ✓ Mark Complete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
