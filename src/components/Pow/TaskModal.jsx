import { useState, useEffect } from 'react';
import { X, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { usePow } from '../../context/PowContext.jsx';
import styles from './TaskModal.module.css';

export default function TaskModal({ task, onClose }) {
  const { categories, addTask, updateTask } = usePow();
  const isEdit = Boolean(task?.id);

  const [title,       setTitle]      = useState(task?.title       ?? '');
  const [description, setDesc]       = useState(task?.description ?? '');
  const [categoryId,  setCategoryId] = useState(task?.categoryId  ?? categories[0]?.id ?? '');
  // Steps as array, always at least 1 empty
  const [steps, setSteps] = useState(() => {
    const s = task?.steps;
    if (Array.isArray(s) && s.length > 0) return s;
    return [''];
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const updateStep = (i, val) => setSteps(prev => prev.map((s, idx) => idx === i ? val : s));
  const addStep    = () => setSteps(prev => [...prev, '']);
  const removeStep = (i) => setSteps(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev);

  const handleKeyDown = (e, i) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setSteps(prev => [...prev.slice(0, i + 1), '', ...prev.slice(i + 1)]);
      // focus next input after render
      setTimeout(() => {
        const inputs = document.querySelectorAll('[data-step-input]');
        if (inputs[i + 1]) inputs[i + 1].focus();
      }, 10);
    }
    if (e.key === 'Backspace' && steps[i] === '' && steps.length > 1) {
      e.preventDefault();
      removeStep(i);
      setTimeout(() => {
        const inputs = document.querySelectorAll('[data-step-input]');
        if (inputs[i - 1]) inputs[i - 1].focus();
      }, 10);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) { setError('Βάλε τίτλο για το task.'); return; }
    const cleanSteps = steps.map(s => s.trim()).filter(Boolean);
    setSaving(true);
    try {
      if (isEdit) {
        await updateTask(task.id, { title, description, steps: cleanSteps, categoryId });
      } else {
        await addTask({ title, description, steps: cleanSteps, categoryId });
      }
      onClose();
    } catch {
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

          <div className={styles.stepsSection}>
            <div className={styles.stepsHeader}>
              <span className={styles.stepsLabel}>Steps</span>
              <button type="button" className={styles.addStepBtn} onClick={addStep}>
                <Plus size={13}/> Προσθήκη step
              </button>
            </div>
            <div className={styles.stepsList}>
              {steps.map((step, i) => (
                <div key={i} className={styles.stepRow}>
                  <span className={styles.stepNum}>{i + 1}.</span>
                  <input
                    data-step-input
                    className={styles.stepInput}
                    value={step}
                    onChange={e => updateStep(i, e.target.value)}
                    onKeyDown={e => handleKeyDown(e, i)}
                    placeholder={`Step ${i + 1}...`}
                  />
                  {steps.length > 1 && (
                    <button type="button" className={styles.removeStepBtn} onClick={() => removeStep(i)}>
                      <Trash2 size={12}/>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

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
