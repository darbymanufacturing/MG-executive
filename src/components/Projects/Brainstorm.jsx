import { useState } from 'react';
import { Plus, X, Tag, Check, Archive, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { useProjects } from '../../context/ProjectContext.jsx';
import styles from './Brainstorm.module.css';
import sharedStyles from './Projects.module.css';

const TAGS = ['General', 'Revenue', 'Operations', 'Technology', 'Fleet', 'Cities'];

export default function Brainstorm() {
  const { brainstormIdeas, addBrainstormIdea, deleteBrainstormIdea, updateBrainstormIdea } = useProjects();
  const [showForm, setShowForm]       = useState(false);
  const [text, setText]               = useState('');
  const [tag, setTag]                 = useState('General');
  const [filterTag, setFilterTag]     = useState('All');
  const [showArchived, setShowArchived] = useState(false);
  const [saving, setSaving]           = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setSaving(true);
    try {
      await addBrainstormIdea({ text: text.trim(), tag });
      setText('');
      setTag('General');
      setShowForm(false);
    } catch (err) {
      console.error('Failed to add idea:', err);
    }
    setSaving(false);
  }

  async function toggleDone(idea) {
    try {
      await updateBrainstormIdea(idea._docId, { done: !idea.done });
    } catch (err) {
      console.error('Failed to update idea:', err);
    }
  }

  async function archiveIdea(idea) {
    try {
      await updateBrainstormIdea(idea._docId, { archived: true, archivedAt: new Date().toISOString() });
    } catch (err) {
      console.error('Failed to archive idea:', err);
    }
  }

  async function restoreIdea(idea) {
    try {
      await updateBrainstormIdea(idea._docId, { archived: false, archivedAt: null });
    } catch (err) {
      console.error('Failed to restore idea:', err);
    }
  }

  const active   = brainstormIdeas.filter((i) => !i.archived);
  const archived = brainstormIdeas.filter((i) => i.archived);

  const filteredActive = filterTag === 'All'
    ? active
    : active.filter((i) => i.tag === filterTag);

  // Put done ideas at the bottom of the active list
  const sortedActive = [
    ...filteredActive.filter((i) => !i.done),
    ...filteredActive.filter((i) =>  i.done),
  ];

  const filteredArchived = filterTag === 'All'
    ? archived
    : archived.filter((i) => i.tag === filterTag);

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

      {/* Active ideas list */}
      {sortedActive.length === 0 ? (
        <p className={sharedStyles.empty}>
          {active.length === 0
            ? 'No ideas yet — hit "Add Idea" to capture your first one.'
            : 'No ideas with this tag.'}
        </p>
      ) : (
        <ul className={styles.list}>
          {sortedActive.map((idea) => (
            <li key={idea._docId} className={`${styles.entry} ${idea.done ? styles.entryDone : ''}`}>
              <div className={styles.entryMeta}>
                <span className={styles.date}>{(idea.createdAt?.toDate ? idea.createdAt.toDate().toISOString() : String(idea.createdAt || '')).slice(0, 10)}</span>
                {idea.tag && idea.tag !== 'General' && (
                  <span className={styles.tagBadge}>{idea.tag}</span>
                )}
                {idea.done && <span className={styles.doneBadge}>Done</span>}
              </div>
              <div className={styles.entryBody}>
                <span className={`${styles.ideaText} ${idea.done ? styles.ideaTextDone : ''}`}>
                  {idea.text}
                </span>
                <div className={styles.entryActions}>
                  <button
                    className={`${styles.actionBtn} ${idea.done ? styles.actionBtnDone : ''}`}
                    onClick={() => toggleDone(idea)}
                    title={idea.done ? 'Mark as active' : 'Mark as done'}
                  >
                    <Check size={13} />
                  </button>
                  {idea.done && (
                    <button
                      className={`${styles.actionBtn} ${styles.actionBtnArchive}`}
                      onClick={() => archiveIdea(idea)}
                      title="Archive this idea"
                    >
                      <Archive size={13} />
                    </button>
                  )}
                  <button
                    className={styles.deleteBtn}
                    onClick={() => { if (window.confirm('Delete this idea? This cannot be undone.')) deleteBrainstormIdea(idea._docId); }}
                    title="Delete"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Archived section */}
      {archived.length > 0 && (
        <div className={styles.archivedSection}>
          <button
            className={styles.archivedToggle}
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            Archived
            <span className={styles.archivedCount}>{archived.length}</span>
          </button>

          {showArchived && (
            <ul className={styles.list} style={{ marginTop: 8 }}>
              {filteredArchived.map((idea) => (
                <li key={idea._docId} className={`${styles.entry} ${styles.entryArchived}`}>
                  <div className={styles.entryMeta}>
                    <span className={styles.date}>{(idea.createdAt?.toDate ? idea.createdAt.toDate().toISOString() : String(idea.createdAt || '')).slice(0, 10)}</span>
                    {idea.tag && idea.tag !== 'General' && (
                      <span className={styles.tagBadge}>{idea.tag}</span>
                    )}
                    <span className={styles.archivedBadge}>Archived</span>
                  </div>
                  <div className={styles.entryBody}>
                    <span className={`${styles.ideaText} ${styles.ideaTextDone}`}>
                      {idea.text}
                    </span>
                    <div className={styles.entryActions}>
                      <button
                        className={`${styles.actionBtn} ${styles.actionBtnRestore}`}
                        onClick={() => restoreIdea(idea)}
                        title="Restore to active"
                      >
                        <RotateCcw size={13} />
                      </button>
                      <button
                        className={styles.deleteBtn}
                        onClick={() => { if (window.confirm('Delete this idea? This cannot be undone.')) deleteBrainstormIdea(idea._docId); }}
                        title="Delete permanently"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
              {filteredArchived.length === 0 && (
                <p className={sharedStyles.empty} style={{ padding: '12px 16px' }}>
                  No archived ideas with this tag.
                </p>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
