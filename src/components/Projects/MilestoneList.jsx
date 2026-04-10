import { useState } from 'react';
import { CheckSquare, Square, Trash2, Plus } from 'lucide-react';
import styles from './MilestoneList.module.css';

export default function MilestoneList({ milestones = [], onToggle, onAdd, onDelete }) {
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate]   = useState('');

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
          <li key={m.id} className={`${styles.item} ${m.done ? styles.done : ''}`}>
            <button className={styles.checkBtn} onClick={() => onToggle(m.id)} title="Toggle">
              {m.done ? <CheckSquare size={15} /> : <Square size={15} />}
            </button>
            <span className={styles.title}>{m.title}</span>
            {m.dueDate && (
              <span className={styles.due}>{m.dueDate}</span>
            )}
            <button className={styles.deleteBtn} onClick={() => onDelete(m.id)} title="Remove">
              <Trash2 size={12} />
            </button>
          </li>
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
          className={styles.addDate}
        />
        <button type="submit" className={styles.addBtn} title="Add">
          <Plus size={14} />
        </button>
      </form>
    </div>
  );
}
