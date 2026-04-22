import { useState } from 'react';
import { X } from 'lucide-react';
import { getSteps } from './StepsList.jsx';
import styles from './AssignStepsModal.module.css';

export default function AssignStepsModal({ task, person, onConfirm, onClose }) {
  const steps = getSteps(task);
  const existingSelected = task.powSteps?.[person] ?? steps.map((_, i) => i);
  const [selected, setSelected] = useState(new Set(existingSelected));

  const toggle = (idx) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  // No steps — assign directly without modal
  if (steps.length === 0) {
    onConfirm([]);
    onClose();
    return null;
  }

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div>
            <h2>Assign σε {person}</h2>
            <p className={styles.subtitle}>{task.title}</p>
          </div>
          <button className={styles.closeBtn} onClick={onClose}><X size={18}/></button>
        </div>

        <p className={styles.hint}>Επέλεξε ποια steps θα εμφανιστούν στο POW board:</p>

        <div className={styles.stepsList}>
          {steps.map((content, idx) => (
            <label key={idx} className={`${styles.step} ${selected.has(idx) ? styles.selected : ''}`}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={selected.has(idx)}
                onChange={() => toggle(idx)}
              />
              <span className={styles.stepNum}>{idx + 1}.</span>
              <span className={styles.stepText}>{content}</span>
            </label>
          ))}
        </div>

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onClose}>Άκυρο</button>
          <button className={styles.confirmBtn} onClick={() => { onConfirm([...selected]); onClose(); }}>
            Assign ({selected.size} steps)
          </button>
        </div>
      </div>
    </div>
  );
}
