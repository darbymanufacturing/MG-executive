import styles from './StepsList.module.css';

/** Parse a summary string into an array of {type: 'step'|'text', content, index} */
export function parseSteps(summary) {
  if (!summary?.trim()) return [];
  let stepIdx = -1;
  return summary.split('\n').map(line => {
    const trimmed = line.trim();
    const isStep  = /^(\d+[\.\)]|[-•])\s/.test(trimmed);
    if (isStep) {
      stepIdx++;
      return { type: 'step', index: stepIdx, content: trimmed.replace(/^(\d+[\.\)]|[-•])\s+/, '') };
    }
    return { type: 'text', content: trimmed };
  }).filter(l => l.content);
}

export default function StepsList({ summary, checkedSteps = [], onToggle }) {
  const lines = parseSteps(summary);
  if (!lines.length) return <pre className={styles.plain}>{summary}</pre>;

  return (
    <div className={styles.list}>
      {lines.map((line, i) => {
        if (line.type === 'text') {
          return <p key={i} className={styles.textLine}>{line.content}</p>;
        }
        const checked = checkedSteps.includes(line.index);
        return (
          <label key={i} className={`${styles.step} ${checked ? styles.checked : ''}`}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={checked}
              onChange={() => onToggle?.(line.index)}
              readOnly={!onToggle}
            />
            <span className={styles.stepText}>{line.content}</span>
          </label>
        );
      })}
    </div>
  );
}
