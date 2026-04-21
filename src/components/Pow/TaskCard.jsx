import { useState } from 'react';
import { CheckCircle, Circle, Pencil, Trash2, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { usePow } from '../../context/PowContext.jsx';
import TaskModal from './TaskModal.jsx';
import styles from './TaskCard.module.css';

const ASSIGNEE_COLORS = {
  Panos:  'var(--color-primary)',
  Kostas: 'var(--color-info)',
};

export default function TaskCard({ task }) {
  const { markDone, markTodo, deleteTask } = usePow();
  const [expanded, setExpanded] = useState(false);
  const [editing,  setEditing]  = useState(false);

  const isDone = task.status === 'done';
  const hasSummary = task.summary?.trim();

  return (
    <>
      <div className={`${styles.card} ${isDone ? styles.done : ''}`}>
        {/* Top row: status + title + actions */}
        <div className={styles.top}>
          <button
            className={styles.statusBtn}
            onClick={() => isDone ? markTodo(task.id) : markDone(task.id)}
            title={isDone ? 'Undo done' : 'Mark done'}
          >
            {isDone
              ? <CheckCircle size={17} className={styles.doneIcon} />
              : <Circle      size={17} className={styles.todoIcon} />
            }
          </button>

          <span className={`${styles.title} ${isDone ? styles.strikethrough : ''}`}>
            {task.title}
          </span>

          <div className={styles.actions}>
            {isDone && (
              <button className={styles.iconBtn} onClick={() => markTodo(task.id)} title="Επαναφορά">
                <RotateCcw size={13} />
              </button>
            )}
            {!isDone && (
              <button className={styles.iconBtn} onClick={() => setEditing(true)} title="Επεξεργασία">
                <Pencil size={13} />
              </button>
            )}
            <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => deleteTask(task.id)} title="Διαγραφή">
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Assignee badge */}
        <div className={styles.meta}>
          <span
            className={styles.assignee}
            style={{ '--ac': ASSIGNEE_COLORS[task.assignee] ?? 'var(--color-primary)' }}
          >
            {task.assignee}
          </span>
          {task.description && (
            <span className={styles.description}>{task.description}</span>
          )}
        </div>

        {/* Summary / Steps (collapsible) */}
        {hasSummary && (
          <>
            <button className={styles.expandBtn} onClick={() => setExpanded(v => !v)}>
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {expanded ? 'Κρύψε steps' : 'Δες steps'}
            </button>
            {expanded && (
              <pre className={styles.summary}>{task.summary}</pre>
            )}
          </>
        )}
      </div>

      {editing && <TaskModal task={task} onClose={() => setEditing(false)} />}
    </>
  );
}
