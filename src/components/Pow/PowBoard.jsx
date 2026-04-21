import { useState } from 'react';
import { Plus, Settings2, Trash2, Check, X } from 'lucide-react';
import { usePow } from '../../context/PowContext.jsx';
import TaskCard from './TaskCard.jsx';
import TaskModal from './TaskModal.jsx';
import styles from './PowBoard.module.css';

const ASSIGNEES = ['Panos', 'Kostas'];

function CategoryColumn({ cat }) {
  const { activeTasks, doneTasks, showDone, addCategory, removeCategory, renameCategory } = usePow();
  const [addingTask, setAddingTask] = useState(false);
  const [editing,    setEditing]    = useState(false);
  const [newName,    setNewName]    = useState(cat.name);

  const colActiveTasks = activeTasks.filter(t => t.categoryId === cat.id);
  const colDoneTasks   = doneTasks.filter(t => t.categoryId === cat.id);

  const handleRename = () => {
    if (newName.trim() && newName !== cat.name) renameCategory(cat.id, newName.trim());
    setEditing(false);
  };

  return (
    <div className={styles.column}>
      {/* Column header */}
      <div className={styles.colHeader}>
        {editing ? (
          <div className={styles.renameRow}>
            <input
              className={styles.renameInput}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setEditing(false); }}
              autoFocus
            />
            <button className={styles.iconBtn} onClick={handleRename}><Check size={13}/></button>
            <button className={styles.iconBtn} onClick={() => setEditing(false)}><X size={13}/></button>
          </div>
        ) : (
          <>
            <span className={styles.colName} onClick={() => setEditing(true)} title="Click to rename">
              {cat.name}
            </span>
            <div className={styles.colActions}>
              <span className={styles.taskCount}>{colActiveTasks.length}</span>
              <button className={styles.iconBtn} onClick={() => removeCategory(cat.id)} title="Διαγραφή κατηγορίας">
                <Trash2 size={12}/>
              </button>
            </div>
          </>
        )}
      </div>

      {/* Grouped by assignee */}
      <div className={styles.colBody}>
        {ASSIGNEES.map(assignee => {
          const userTasks     = colActiveTasks.filter(t => t.assignee === assignee);
          const userDoneTasks = colDoneTasks.filter(t => t.assignee === assignee);
          const hasAny        = userTasks.length > 0 || (showDone && userDoneTasks.length > 0);

          return (
            <div key={assignee} className={styles.assigneeGroup}>
              <div className={styles.assigneeLabel}>{assignee}</div>
              {userTasks.length === 0 && (!showDone || userDoneTasks.length === 0) && (
                <p className={styles.empty}>—</p>
              )}
              {userTasks.map(t => <TaskCard key={t.id} task={t} />)}
              {showDone && userDoneTasks.map(t => <TaskCard key={t.id} task={t} />)}
            </div>
          );
        })}

        <button className={styles.addTaskBtn} onClick={() => setAddingTask(true)}>
          <Plus size={13}/> Add Task
        </button>
      </div>

      {addingTask && (
        <TaskModal
          task={{ categoryId: cat.id }}
          onClose={() => setAddingTask(false)}
        />
      )}
    </div>
  );
}

export default function PowBoard() {
  const { categories, addCategory } = usePow();
  const [addingCat, setAddingCat]   = useState(false);
  const [newCatName, setNewCatName] = useState('');

  const handleAddCat = () => {
    if (newCatName.trim()) {
      addCategory(newCatName.trim());
      setNewCatName('');
      setAddingCat(false);
    }
  };

  return (
    <div className={styles.board}>
      {categories
        .slice()
        .sort((a, b) => a.order - b.order)
        .map(cat => <CategoryColumn key={cat.id} cat={cat} />)
      }

      {/* Add category */}
      <div className={styles.addCatCol}>
        {addingCat ? (
          <div className={styles.addCatBox}>
            <input
              className={styles.addCatInput}
              placeholder="Όνομα κατηγορίας..."
              value={newCatName}
              onChange={e => setNewCatName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddCat(); if (e.key === 'Escape') setAddingCat(false); }}
              autoFocus
            />
            <div className={styles.addCatActions}>
              <button className={styles.addCatConfirm} onClick={handleAddCat}>Προσθήκη</button>
              <button className={styles.addCatCancel} onClick={() => setAddingCat(false)}><X size={14}/></button>
            </div>
          </div>
        ) : (
          <button className={styles.addCatBtn} onClick={() => setAddingCat(true)}>
            <Plus size={15}/> Νέα Κατηγορία
          </button>
        )}
      </div>
    </div>
  );
}
