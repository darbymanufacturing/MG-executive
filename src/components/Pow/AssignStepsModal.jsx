import { useState } from 'react';
import { X } from 'lucide-react';
import { parseSteps } from './StepsList.jsx';
import styles from './AssignStepsModal.module.css';

export default function AssignStepsModal({ task, person, onConfirm, onClose }) {
  const steps = parseSteps(task.summary).filter(l => l.type === 'step');
  const existingSelected = task.powSteps?.[person] ?? steps.map(s => s.index);
  const [selected, setSelected] = useState(new Set(existingSelected));

  const toggleStep = (idx) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const handleConfirm = () => {
    onConfirm([...selected]);
    onClose();
  };

  // No steps defined — just assign directly
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
          {steps.map(step => (
            <label key={step.index} className={`${styles.step} ${selected.has(step.index) ? styles.selected : ''}`}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={selected.has(step.index)}
                onChange={() => toggleStep(step.index)}
              />
              <span className={styles.stepText}>{step.content}</span>
            </label>
          ))}
        </div>

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onClose}>Άκυρο</button>
          <button className={styles.confirmBtn} onClick={handleConfirm}>
            Assign ({selected.size} steps)
          </button>
        </div>
      </div>
    </div>
  );
}
