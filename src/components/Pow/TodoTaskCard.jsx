import { useState } from 'react';
import { CheckCircle, Circle, Pencil, Trash2, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { usePow } from '../../context/PowContext.jsx';
import StepsList from './StepsList.jsx';
import TaskModal from './TaskModal.jsx';
import styles from './TodoTaskCard.module.css';

const ASSIGNEES = ['Panos', 'Kostas'];

const ASSIGNEE_COLORS = {
  Panos:  'var(--color-primary)',
  Kostas: 'var(--color-info)',
};

export default function TodoTaskCard({ task }) {
  const { categories, markDone, markBacklog, deleteTask, toggleAssignee, toggleStep } = usePow();
  const [expanded, setExpanded] = useState(false);
  const [editing,  setEditing]  = useState(false);

  const isDone     = task.status === 'done';
  const assignees  = task.assignees ?? [];
  const hasSummary = task.summary?.trim();
  const category   = categories.find(c => c.id === task.categoryId);

  return (
    <>
      <div className={`${styles.card} ${isDone ? styles.done : ''} ${assignees.length > 0 && !isDone ? styles.assigned : ''}`}>
        {/* Top row */}
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

        {/* Meta: category + description */}
        <div className={styles.meta}>
          {category && <span className={styles.catBadge}>{category.name}</span>}
          {task.description && <span className={styles.description}>{task.description}</span>}
        </div>

        {/* Assign toggle buttons */}
        {!isDone && (
          <div className={styles.assignRow}>
            <span className={styles.assignLabel}>POW:</span>
            {ASSIGNEES.map(person => {
              const isAssigned = assignees.includes(person);
              return (
                <button
                  key={person}
                  className={`${styles.assignToggle} ${isAssigned ? styles.assignToggleActive : ''}`}
                  style={isAssigned ? { '--ac': ASSIGNEE_COLORS[person] } : {}}
                  onClick={() => toggleAssignee(task.id, person)}
                  title={isAssigned ? `Αφαίρεση ${person}` : `Assign σε ${person}`}
                >
                  {person}
                </button>
              );
            })}
          </div>
        )}

        {/* Summary / Steps */}
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
