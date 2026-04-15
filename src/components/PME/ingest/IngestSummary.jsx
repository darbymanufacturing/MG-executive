import styles from './IngestSummary.module.css';

export default function IngestSummary({ result }) {
  if (!result) return null;
  const { written = 0, duplicates = 0, errors = [], label = 'Events' } = result;
  const hasErrors = errors.length > 0;

  return (
    <div className={`${styles.summary} ${hasErrors ? styles.hasErrors : ''}`}>
      <div className={styles.row}>
        <span className={styles.new}>{written.toLocaleString()} new {label.toLowerCase()}</span>
        {duplicates > 0 && (
          <span className={styles.dup}>{duplicates.toLocaleString()} duplicates skipped</span>
        )}
        {written === 0 && duplicates === 0 && !hasErrors && (
          <span className={styles.dup}>Nothing to import</span>
        )}
      </div>
      {hasErrors && (
        <details className={styles.errors}>
          <summary>{errors.length} row error{errors.length > 1 ? 's' : ''}</summary>
          <ul>
            {errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
            {errors.length > 20 && <li>…and {errors.length - 20} more</li>}
          </ul>
        </details>
      )}
    </div>
  );
}
