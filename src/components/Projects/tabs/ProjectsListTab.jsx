import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useProjects } from '../../../context/ProjectContext.jsx';
import ProjectCard from '../ProjectCard.jsx';
import ProjectForm from '../ProjectForm.jsx';
import ConfirmDialog from '../../Shared/ConfirmDialog.jsx';
import Button from '../../Shared/Button.jsx';
import styles from './ProjectsListTab.module.css';

const STATUS_FILTERS = ['All', 'Green', 'Amber', 'Red'];
const CATEGORY_FILTERS = ['All', 'Expansion', 'Operations', 'Technology', 'Finance', 'Legal'];
const OWNER_FILTERS = ['All', 'Kostas', 'Panos', 'Both'];

export default function ProjectsListTab() {
  const { activeProjects, addProject, updateProject, deleteProject } = useProjects();

  const [formOpen, setFormOpen]   = useState(false);
  const [editing, setEditing]     = useState(null);
  const [deleting, setDeleting]   = useState(null);
  const [statusF, setStatusF]     = useState('All');
  const [categoryF, setCategoryF] = useState('All');
  const [ownerF, setOwnerF]       = useState('All');
  const [search, setSearch]       = useState('');

  const filtered = activeProjects.filter((p) => {
    if (statusF   !== 'All' && p.status   !== statusF)   return false;
    if (categoryF !== 'All' && p.category !== categoryF) return false;
    if (ownerF    !== 'All' && p.owner    !== ownerF)    return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) &&
        !p.description?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Sort: Red → Amber → Green, then by name
  const STATUS_ORDER = { Red: 0, Amber: 1, Green: 2 };
  const sorted = [...filtered].sort((a, b) => {
    const so = (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3);
    return so !== 0 ? so : a.name.localeCompare(b.name);
  });

  async function handleSave(form) {
    if (editing) {
      await updateProject(editing._docId, form);
    } else {
      await addProject(form);
    }
    setEditing(null);
  }

  function openEdit(project) {
    setEditing(project);
    setFormOpen(true);
  }

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }

  async function handleDelete() {
    if (!deleting) return;
    await deleteProject(deleting);
    setDeleting(null);
  }

  return (
    <div className={styles.wrap}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <input
          className={styles.search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search projects…"
        />

        <div className={styles.chips}>
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              className={`${styles.chip} ${statusF === s ? styles.chipActive : ''}`}
              onClick={() => setStatusF(s)}
            >
              {s === 'Green' ? '🟢' : s === 'Amber' ? '🟡' : s === 'Red' ? '🔴' : ''} {s}
            </button>
          ))}
        </div>

        <div className={styles.chips}>
          {CATEGORY_FILTERS.map((c) => (
            <button
              key={c}
              className={`${styles.chip} ${categoryF === c ? styles.chipActive : ''}`}
              onClick={() => setCategoryF(c)}
            >
              {c}
            </button>
          ))}
        </div>

        <div className={styles.chips}>
          {OWNER_FILTERS.map((o) => (
            <button
              key={o}
              className={`${styles.chip} ${ownerF === o ? styles.chipActive : ''}`}
              onClick={() => setOwnerF(o)}
            >
              {o}
            </button>
          ))}
        </div>

        <Button variant="primary" size="sm" onClick={openNew}>
          <Plus size={14} /> New Project
        </Button>
      </div>

      {/* Count */}
      {activeProjects.length > 0 && (
        <p className={styles.count}>
          Showing {sorted.length} of {activeProjects.length} active project{activeProjects.length !== 1 ? 's' : ''}
        </p>
      )}

      {/* List */}
      {sorted.length === 0 ? (
        <div className={styles.empty}>
          <p>{activeProjects.length === 0 ? 'No projects yet. Click "New Project" to get started.' : 'No projects match the current filters.'}</p>
          {activeProjects.length === 0 && (
            <Button variant="primary" onClick={openNew}><Plus size={14} /> New Project</Button>
          )}
        </div>
      ) : (
        <div className={styles.list}>
          {sorted.map((p) => (
            <ProjectCard
              key={p._docId}
              project={p}
              onEdit={openEdit}
              onDelete={(id) => setDeleting(id)}
            />
          ))}
        </div>
      )}

      <ProjectForm
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onSave={handleSave}
        initial={editing}
      />

      <ConfirmDialog
        open={!!deleting}
        title="Delete Project"
        message="This will permanently delete the project, all milestones, blockers, and update logs. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
