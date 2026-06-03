import { useState } from 'react';
import { CheckSquare, Square, Trash2, Plus, Pencil, Check, X } from 'lucide-react';
import styles from './MilestoneList.module.css';

function EditableRow({ milestone, onUpdate, onDelete, onToggle }) {
  const [editing, setEditing]   = useState(false);
  const [title,   setTitle]     = useState(milestone.title);
  const [dueDate, setDueDate]   = useState(milestone.dueDate || '');

  function openEdit(e) {
    e.stopPropagation();
    setTitle(milestone.title);
    setDueDate(milestone.dueDate || '');
    setEditing(true);
  }

  function save(e) {
    e?.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    onUpdate(milestone.id, { title: trimmed, dueDate });
    setEditing(false);
  }

  function cancel() {
    setTitle(milestone.title);
    setDueDate(milestone.dueDate || '');
    setEditing(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') cancel();
  }

  if (editing) {
    return (
      <li className={`${styles.item} ${styles.editing}`}>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          className={styles.editTitle}
          placeholder="Milestone title…"
        />
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          onKeyDown={handleKeyDown}
          className={styles.editDate}
        />
        <button className={styles.saveBtn} onClick={save} title="Save">
          <Check size={13} />
        </button>
        <button className={styles.cancelBtn} onClick={cancel} title="Cancel">
          <X size={13} />
        </button>
      </li>
    );
  }

  // ── Normal display row ────────────────────────────────────────────────────
  // Compare calendar dates via Date.UTC to avoid UTC+2/+3 off-by-one:
  // new Date("YYYY-MM-DD") parses as midnight UTC which is already "past"
  // in Greece timezone on the deadline day itself.
  const isOverdue = (() => {
    if (!milestone.dueDate || milestone.done) return false;
    const [ty, tm, td] = milestone.dueDate.split('-').map(Number);
    const now = new Date();
    const target = Date.UTC(ty, tm - 1, td);
    const today  = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return target < today;
  })();

  return (
    <li className={`${styles.item} ${milestone.done ? styles.done : ''}`}>
      <button className={styles.checkBtn} onClick={() => onToggle(milestone.id)} title="Toggle">
        {milestone.done ? <CheckSquare size={15} /> : <Square size={15} />}
      </button>
      <span className={styles.title}>{milestone.title}</span>
      {milestone.dueDate ? (
        <span
          className={`${styles.due} ${isOverdue ? styles.overdue : ''}`}
          title="Click to edit date"
          onClick={openEdit}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && openEdit(e)}
        >
          {milestone.dueDate}
        </span>
      ) : (
        <span
          className={styles.addDate}
          title="Add a due date"
          onClick={openEdit}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && openEdit(e)}
        >
          + date
        </span>
      )}
      <button className={styles.editBtn} onClick={openEdit} title="Edit milestone">
        <Pencil size={12} />
      </button>
      <button className={styles.deleteBtn} onClick={() => onDelete(milestone.id)} title="Remove">
        <Trash2 size={12} />
      </button>
    </li>
  );
}

export default function MilestoneList({ milestones = [], onToggle, onAdd, onDelete, onUpdate }) {
  const [newTitle, setNewTitle] = useState('');
  const [newDate,  setNewDate]  = useState('');

  function handleAdd(e) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    onAdd({ title: newTitle.trim(), dueDate: newDate });
    setNewTitle('');
    setNewDate('');
  }

  const done  = milestones.filter((m) => m.done).length;
  const total = milestones.length;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.label}>Milestones</span>
        {total > 0 && (
          <span className={styles.progress}>{done}/{total} complete</span>
        )}
      </div>

      {total > 0 && (
        <div className={styles.bar}>
          <div className={styles.fill} style={{ width: `${(done / total) * 100}%` }} />
        </div>
      )}

      <ul className={styles.list}>
        {milestones.map((m) => (
          <EditableRow
            key={m.id}
            milestone={m}
            onToggle={onToggle}
            onDelete={onDelete}
            onUpdate={onUpdate}
          />
        ))}
      </ul>

      <form className={styles.addRow} onSubmit={handleAdd}>
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Add milestone…"
          className={styles.addInput}
        />
        <input
          type="date"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
          className={styles.addDateInput}
        />
        <button type="submit" className={styles.addBtn} title="Add">
          <Plus size={14} />
        </button>
      </form>
    </div>
  );
}
