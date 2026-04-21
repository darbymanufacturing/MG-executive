import { useState } from 'react';
import { Plus, Trash2, Check, X } from 'lucide-react';
import { usePow } from '../../context/PowContext.jsx';
import TaskCard from './TaskCard.jsx';
import styles from './PowBoard.module.css';

const ASSIGNEES = ['Panos', 'Kostas'];

function CategoryColumn({ cat }) {
  const { powTasks, removeCategory, renameCategory } = usePow();
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState(cat.name);

  const colTasks = powTasks.filter(t => t.categoryId === cat.id);

  const handleRename = () => {
    if (newName.trim() && newName !== cat.name) renameCategory(cat.id, newName.trim());
    setEditing(false);
  };

  return (
    <div className={styles.column}>
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
              <span className={styles.taskCount}>{colTasks.length}</span>
              <button className={styles.iconBtn} onClick={() => removeCategory(cat.id)} title="Διαγραφή κατηγορίας">
                <Trash2 size={12}/>
              </button>
            </div>
          </>
        )}
      </div>

      <div className={styles.colBody}>
        {ASSIGNEES.map(assignee => {
          const userTasks = colTasks.filter(t => t.assignee === assignee);
          return (
            <div key={assignee} className={styles.assigneeGroup}>
              <div className={styles.assigneeLabel}>{assignee}</div>
              {userTasks.length === 0
                ? <p className={styles.empty}>—</p>
                : userTasks.map(t => <TaskCard key={t.id} task={t} />)
              }
            </div>
          );
        })}

        {colTasks.length === 0 && (
          <p className={styles.emptyCol}>Assign tasks από το To Do List</p>
        )}
      </div>
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
