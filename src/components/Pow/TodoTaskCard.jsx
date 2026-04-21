import { useState } from 'react';
import { CheckCircle, Circle, Pencil, Trash2, ChevronDown, ChevronUp, RotateCcw, UserPlus, UserMinus } from 'lucide-react';
import { usePow } from '../../context/PowContext.jsx';
import TaskModal from './TaskModal.jsx';
import styles from './TodoTaskCard.module.css';

const ASSIGNEES = ['Panos', 'Kostas'];

const ASSIGNEE_COLORS = {
  Panos:  'var(--color-primary)',
  Kostas: 'var(--color-info)',
};

export default function TodoTaskCard({ task }) {
  const { categories, markDone, markBacklog, deleteTask, assignToPow, removeFromPow } = usePow();
  const [expanded,       setExpanded]       = useState(false);
  const [editing,        setEditing]        = useState(false);
  const [showAssignMenu, setShowAssignMenu] = useState(false);

  const isDone     = task.status === 'done';
  const isAssigned = task.status === 'pow';
  const hasSummary = task.summary?.trim();
  const category   = categories.find(c => c.id === task.categoryId);

  return (
    <>
      <div className={`${styles.card} ${isDone ? styles.done : ''} ${isAssigned ? styles.assigned : ''}`}>
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
              <button className={styles.iconBtn} onClick={() => setEditing(true)} title="Επεξεργασία">
                <Pencil size={13} />
              </button>
            )}
            {isDone && (
              <button className={styles.iconBtn} onClick={() => markBacklog(task.id)} title="Επαναφορά">
                <RotateCcw size={13} />
              </button>
            )}
            <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => deleteTask(task.id)} title="Διαγραφή">
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Meta row: category + assignee */}
        <div className={styles.meta}>
          {category && (
            <span className={styles.catBadge}>{category.name}</span>
          )}
          {isAssigned && task.assignee && (
            <span
              className={styles.assigneeBadge}
              style={{ '--ac': ASSIGNEE_COLORS[task.assignee] ?? 'var(--color-primary)' }}
            >
              {task.assignee}
            </span>
          )}
          {task.description && (
            <span className={styles.description}>{task.description}</span>
          )}
        </div>

        {/* Assign / Unassign row */}
        {!isDone && (
          <div className={styles.assignRow}>
            {isAssigned ? (
              <button className={styles.unassignBtn} onClick={() => removeFromPow(task.id)}>
                <UserMinus size={12}/> Αφαίρεση από POW
              </button>
            ) : (
              <div className={styles.assignWrap}>
                <button
                  className={styles.assignBtn}
                  onClick={() => setShowAssignMenu(v => !v)}
                >
                  <UserPlus size={12}/> Assign σε POW
                </button>
                {showAssignMenu && (
                  <div className={styles.assignMenu}>
                    {ASSIGNEES.map(a => (
                      <button
                        key={a}
                        className={styles.assignOption}
                        onClick={() => { assignToPow(task.id, a); setShowAssignMenu(false); }}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Summary / Steps */}
        {hasSummary && (
          <>
            <button className={styles.expandBtn} onClick={() => setExpanded(v => !v)}>
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {expanded ? 'Κρύψε steps' : 'Δες steps'}
            </button>
            {expanded && <pre className={styles.summary}>{task.summary}</pre>}
          </>
        )}
      </div>

      {editing && <TaskModal task={task} onClose={() => setEditing(false)} />}
    </>
  );
}
