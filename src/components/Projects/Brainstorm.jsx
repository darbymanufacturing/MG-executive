import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useProjects } from '../../context/ProjectContext.jsx';
import styles from './Brainstorm.module.css';
import sharedStyles from './Projects.module.css';

export default function Brainstorm({ project }) {
  const { addBrainstormIdea, deleteBrainstormIdea } = useProjects();
  const [showForm, setShowForm] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const ideas = project.brainstormIdeas || [];

  async function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setSaving(true);
    await addBrainstormIdea(project._docId, { text: text.trim(), createdBy: project.owner || 'Kostas' });
    setText('');
    setShowForm(false);
    setSaving(false);
  }

  return (
    <div className={styles.container}>
      {ideas.length === 0 && !showForm && (
        <p className={sharedStyles.empty}>No ideas yet — capture anything worth remembering.</p>
      )}

      {ideas.length > 0 && (
        <ul className={styles.list}>
          {ideas.map((idea) => (
            <li key={idea.id} className={styles.entry}>
              <div className={styles.entryMeta}>
                <span className={styles.date}>{idea.date}</span>
                {idea.createdBy && <span className={styles.by}>{idea.createdBy}</span>}
              </div>
              <div className={styles.entryBody}>
                <span className={styles.text}>{idea.text}</span>
                <button
                  className={styles.deleteBtn}
                  onClick={() => deleteBrainstormIdea(project._docId, idea.id)}
                  title="Remove idea"
                >
                  <X size={13} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showForm ? (
        <form className={styles.form} onSubmit={handleSubmit}>
          <textarea
            className={sharedStyles.input}
            placeholder="What's the idea? Don't overthink it — just get it down."
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            autoFocus
            style={{ resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className={sharedStyles.btnGhost} onClick={() => { setShowForm(false); setText(''); }}>
              Cancel
            </button>
            <button type="submit" className={sharedStyles.btnPrimary} disabled={saving || !text.trim()}>
              {saving ? 'Saving…' : 'Add Idea'}
            </button>
          </div>
        </form>
      ) : (
        <button className={styles.addBtn} onClick={() => setShowForm(true)}>
          <Plus size={14} /> Add Idea
        </button>
      )}
    </div>
  );
}
