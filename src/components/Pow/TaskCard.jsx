import { useState } from 'react';
import { CheckCircle, Circle, Pencil, Trash2, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { usePow } from '../../context/PowContext.jsx';
import StepsList from './StepsList.jsx';
import TaskModal from './TaskModal.jsx';
import styles from './TaskCard.module.css';

const ASSIGNEE_COLORS = {
  Panos:  'var(--color-primary)',
  Kostas: 'var(--color-info)',
};

export default function TaskCard({ task }) {
  const { markDone, markBacklog, deleteTask, toggleStep } = usePow();
  const [expanded, setExpanded] = useState(false);
  const [editing,  setEditing]  = useState(false);

  const isDone     = task.status === 'done';
  const hasSummary = task.summary?.trim();

  return (
    <>
      <div className={`${styles.card} ${isDone ? styles.done : ''}`}>
        <div className={styles.top}>
          <button
            className={styles.statusBtn}
            onClick={() => isDone ? markBacklog(task.id) : markDone(task.id)}
            title={isDone ? 'Undo' : 'Mark done'}
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
            {!isDone && (
              <button className={styles.iconBtn} onClick={() => setEditing(true)}><Pencil size={13}/></button>
            )}
            {isDone && (
              <button className={styles.iconBtn} onClick={() => markBacklog(task.id)}><RotateCcw size={13}/></button>
            )}
            <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => deleteTask(task.id)}><Trash2 size={13}/></button>
          </div>
        </div>

        <div className={styles.meta}>
          {(task.assignees ?? []).map(a => (
            <span key={a} className={styles.assignee} style={{ '--ac': ASSIGNEE_COLORS[a] ?? 'var(--color-primary)' }}>
              {a}
            </span>
          ))}
          {task.description && <span className={styles.description}>{task.description}</span>}
        </div>

        {hasSummary && (
          <>
            <button className={styles.expandBtn} onClick={() => setExpanded(v => !v)}>
              {expanded ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
              {expanded ? 'Κρύψε steps' : 'Δες steps'}
            </button>
            {expanded && (
              <StepsList
                summary={task.summary}
                checkedSteps={task.checkedSteps ?? []}
                onToggle={(idx) => toggleStep(task.id, idx)}
              />
            )}
          </>
        )}
      </div>

      {editing && <TaskModal task={task} onClose={() => setEditing(false)} />}
    </>
  );
}
