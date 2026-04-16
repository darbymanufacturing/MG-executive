import { useState } from 'react';
import { Plus, X, Tag } from 'lucide-react';
import { useProjects } from '../../context/ProjectContext.jsx';
import styles from './Brainstorm.module.css';
import sharedStyles from './Projects.module.css';

const TAGS = ['General', 'Revenue', 'Operations', 'Technology', 'Fleet', 'Cities'];

export default function Brainstorm() {
  const { brainstormIdeas, addBrainstormIdea, deleteBrainstormIdea } = useProjects();
  const [showForm, setShowForm] = useState(false);
  const [text, setText] = useState('');
  const [tag, setTag] = useState('General');
  const [filterTag, setFilterTag] = useState('All');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setSaving(true);
    await addBrainstormIdea({ text: text.trim(), tag });
    setText('');
    setTag('General');
    setShowForm(false);
    setSaving(false);
  }

  const filtered = filterTag === 'All'
    ? brainstormIdeas
    : brainstormIdeas.filter((i) => i.tag === filterTag);

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.pageHeader}>
        <div>
          <h2 className={styles.pageTitle}>Brainstorm</h2>
          <p className={styles.pageSubtitle}>Capture ideas before they disappear — refine them later.</p>
        </div>
        <button className={styles.addBtn} onClick={() => setShowForm(true)}>
          <Plus size={15} /> Add Idea
        </button>
      </div>

      {/* Add form */}
      {showForm && (
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
          <div className={styles.formFooter}>
            <div className={styles.tagRow}>
              <Tag size={13} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
              <select
                className={sharedStyles.select}
                style={{ width: 'auto' }}
                value={tag}
                onChange={(e) => setTag(e.target.value)}
              >
                {TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className={sharedStyles.btnGhost} onClick={() => { setShowForm(false); setText(''); }}>
                Cancel
              </button>
              <button type="submit" className={sharedStyles.btnPrimary} disabled={saving || !text.trim()}>
                {saving ? 'Saving…' : 'Add Idea'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Tag filters */}
      <div className={styles.tagFilters}>
        {['All', ...TAGS].map((t) => (
          <button
            key={t}
            className={`${styles.tagChip} ${filterTag === t ? styles.tagChipActive : ''}`}
            onClick={() => setFilterTag(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Ideas list */}
      {filtered.length === 0 ? (
        <p className={sharedStyles.empty}>
          {brainstormIdeas.length === 0
            ? 'No ideas yet — hit "Add Idea" to capture your first one.'
            : 'No ideas with this tag.'}
        </p>
      ) : (
        <ul className={styles.list}>
          {filtered.map((idea) => (
            <li key={idea._docId} className={styles.entry}>
              <div className={styles.entryMeta}>
                <span className={styles.date}>{idea.createdAt?.slice(0, 10)}</span>
                {idea.tag && idea.tag !== 'General' && (
                  <span className={styles.tagBadge}>{idea.tag}</span>
                )}
              </div>
              <div className={styles.entryBody}>
                <span className={styles.ideaText}>{idea.text}</span>
                <button
                  className={styles.deleteBtn}
                  onClick={() => deleteBrainstormIdea(idea._docId)}
                  title="Remove"
                >
                  <X size={13} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
