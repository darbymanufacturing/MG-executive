import { useState } from 'react';
import { CheckCircle, Circle, Pencil, Trash2, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { usePow } from '../../context/PowContext.jsx';
import { getSteps } from './StepsList.jsx';
import TaskModal from './TaskModal.jsx';
import styles from './TaskCard.module.css';

const ASSIGNEE_COLORS = {
  Panos:  'var(--color-primary)',
  Kostas: 'var(--color-info)',
};

/**
 * assigneeContext: the person this card is rendered under (for POW board).
 * If null, show all assignees and all steps.
 */
export default function TaskCard({ task, assigneeContext = null }) {
  const { markDone, markBacklog, deleteTask } = usePow();
  const [expanded, setExpanded] = useState(false);
  const [editing,  setEditing]  = useState(false);

  const isDone   = task.status === 'done';
  const allSteps = getSteps(task);

  // Which steps to show in POW board for this person
  const powStepIndices = assigneeContext
    ? (task.powSteps?.[assigneeContext] ?? allSteps.map(s => s.index))
    : null;

  const visibleSteps = powStepIndices !== null
    ? allSteps.filter((_, i) => powStepIndices.includes(i))
    : allSteps;

  const hasMoreSteps = powStepIndices !== null && visibleSteps.length < allSteps.length;

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

        {/* Steps */}
        {visibleSteps.length > 0 && (
          <>
            <button className={styles.expandBtn} onClick={() => setExpanded(v => !v)}>
              {expanded ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
              {expanded ? 'Κρύψε steps' : `Δες steps (${visibleSteps.length})`}
            </button>
            {expanded && (
              <div className={styles.stepsList}>
                {visibleSteps.map((content, i) => (
                  <div key={i} className={styles.step}>
                    <span className={styles.stepBullet}>•</span>
                    <span className={styles.stepText}>{content}</span>
                  </div>
                ))}
                {hasMoreSteps && (
                  <div className={styles.moreSteps}>
                    + {allSteps.length - visibleSteps.length} more steps in To Do List
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* If no visible steps but there are more */}
        {visibleSteps.length === 0 && allSteps.length > 0 && (
          <div className={styles.moreStepsInline}>
            All {allSteps.length} steps in To Do List
          </div>
        )}
      </div>

      {editing && <TaskModal task={task} onClose={() => setEditing(false)} />}
    </>
  );
}
