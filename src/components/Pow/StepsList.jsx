import styles from './StepsList.module.css';

/** Get steps array from task (new: steps[], old: parse summary string) */
export function getSteps(task) {
  if (Array.isArray(task?.steps) && task.steps.length > 0) return task.steps;
  if (!task?.summary?.trim()) return [];
  return task.summary
    .split('\n')
    .map(l => l.replace(/^(\d+[.)]|[-•])\s+/, '').trim())
    .filter(Boolean);
}

export default function StepsList({ steps = [], checkedSteps = [], onToggle }) {
  if (!steps.length) return null;

  return (
    <div className={styles.list}>
      {steps.map((content, index) => {
        const checked = checkedSteps.includes(index);
        return (
          <label key={index} className={`${styles.step} ${checked ? styles.checked : ''}`}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={checked}
              onChange={() => onToggle?.(index)}
            />
            <span className={styles.stepText}>{content}</span>
          </label>
        );
      })}
    </div>
  );
}
