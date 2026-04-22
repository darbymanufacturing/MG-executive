import { useState, useEffect } from 'react';
import { X, ChevronDown } from 'lucide-react';
import { usePow } from '../../context/PowContext.jsx';
import styles from './TaskModal.module.css';

export default function TaskModal({ task, onClose }) {
  const { categories, addTask, updateTask } = usePow();
  const isEdit = Boolean(task?.id);

  const [title,       setTitle]      = useState(task?.title       ?? '');
  const [description, setDesc]       = useState(task?.description ?? '');
  const [summary,     setSummary]    = useState(task?.summary     ?? '');
  const [categoryId,  setCategoryId] = useState(task?.categoryId  ?? categories[0]?.id ?? '');
  const [saving,      setSaving]     = useState(false);
  const [error,       setError]      = useState('');

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) { setError('Βάλε τίτλο για το task.'); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await updateTask(task.id, { title, description, summary, categoryId });
      } else {
        await addTask({ title, description, summary, categoryId });
      }
      onClose();
    } catch (err) {
      setError('Κάτι πήγε στραβά. Δοκίμασε ξανά.');
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2>{isEdit ? 'Edit Task' : 'New Task'}</h2>
          <button className={styles.closeBtn} onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            Τίτλος <span className={styles.required}>*</span>
            <input
              className={styles.input}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="π.χ. Φτιάξε login flow"
              autoFocus
            />
          </label>

          <label className={styles.label}>
            Κατηγορία
            <div className={styles.selectWrap}>
              <select className={styles.select} value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <ChevronDown size={14} className={styles.chevron} />
            </div>
          </label>

          <label className={styles.label}>
            Περιγραφή
            <input
              className={styles.input}
              value={description}
              onChange={e => setDesc(e.target.value)}
              placeholder="Σύντομη περιγραφή..."
            />
          </label>

          <label className={styles.label}>
            Steps
            <textarea
              className={styles.textarea}
              value={summary}
              onChange={e => setSummary(e.target.value)}
              placeholder={"1. ...\n2. ...\n3. ..."}
              rows={5}
            />
          </label>

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>Άκυρο</button>
            <button type="submit" className={styles.submitBtn} disabled={saving}>
              {saving ? 'Αποθήκευση...' : isEdit ? 'Αποθήκευση' : 'Προσθήκη'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
