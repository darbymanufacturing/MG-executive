import { useState } from 'react';
import {
  ChevronDown, ChevronUp, Pencil, Archive, Trash2,
  AlertTriangle, CheckSquare, MessageSquare, Plus, X,
} from 'lucide-react';
import MilestoneList from './MilestoneList.jsx';
import { useProjects } from '../../context/ProjectContext.jsx';
import styles from './ProjectCard.module.css';

const STATUS_COLOR = { Green: '#22c55e', Amber: '#f59e0b', Red: '#ef4444' };
const STATUS_EMOJI = { Green: '🟢', Amber: '🟡', Red: '🔴' };

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr) - new Date();
  return Math.ceil(diff / 86400000);
}

export default function ProjectCard({ project, onEdit, onDelete }) {
  const [expanded, setExpanded]     = useState(false);
  const [blockerText, setBlockerText] = useState('');
  const [updateText, setUpdateText]   = useState('');
  const [showAddBlocker, setShowAddBlocker] = useState(false);
  const [showAddUpdate, setShowAddUpdate]   = useState(false);

  const {
    toggleMilestone, addMilestone, deleteMilestone, updateMilestone,
    addBlocker, toggleBlocker, deleteBlocker,
    addUpdate, archiveProject,
  } = useProjects();

  const daysLeft = daysUntil(project.targetDate);
  const urgentMilestones = (project.milestones || []).filter((m) => {
    if (m.done) return false;
    const d = daysUntil(m.dueDate);
    return d !== null && d <= 7;
  });

  const activeBlockers = (project.blockers || []).filter((b) => !b.resolved);

  async function handleAddBlocker(e) {
    e.preventDefault();
    if (!blockerText.trim()) return;
    await addBlocker(project._docId, blockerText.trim());
    setBlockerText('');
    setShowAddBlocker(false);
  }

  async function handleAddUpdate(e) {
    e.preventDefault();
    if (!updateText.trim()) return;
    await addUpdate(project._docId, updateText.trim());
    setUpdateText('');
    setShowAddUpdate(false);
  }

  return (
    <div className={`${styles.card} ${styles[`status${project.status}`]}`}>
      {/* ── Header row ── */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.statusDot} style={{ background: STATUS_COLOR[project.status] }} />
          <div className={styles.titleBlock}>
            <h3 className={styles.name}>{project.name}</h3>
            <div className={styles.meta}>
              <span className={styles.metaPill}>{project.category}</span>
              <span className={styles.metaPill}>{project.owner}</span>
              {project.targetDate && (
                <span className={`${styles.metaPill} ${daysLeft !== null && daysLeft < 14 ? styles.urgent : ''}`}>
                  {daysLeft !== null && daysLeft < 0
                    ? `⚠ ${Math.abs(daysLeft)}d overdue`
                    : daysLeft !== null
                    ? `${daysLeft}d left`
                    : project.targetDate}
                </span>
              )}
              {activeBlockers.length > 0 && (
                <span className={`${styles.metaPill} ${styles.blockerPill}`}>
                  <AlertTriangle size={11} /> {activeBlockers.length} blocker{activeBlockers.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className={styles.headerActions}>
          <span className={styles.ragBadge} style={{ color: STATUS_COLOR[project.status] }}>
            {STATUS_EMOJI[project.status]} {project.status}
          </span>
          <button className={styles.iconBtn} onClick={() => onEdit(project)} title="Edit">
            <Pencil size={14} />
          </button>
          <button className={styles.iconBtn} onClick={() => setExpanded((e) => !e)} title={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* ── Description (always visible) ── */}
      {project.description && (
        <p className={styles.description}>{project.description}</p>
      )}

      {/* ── Expanded detail ── */}
      {expanded && (
        <div className={styles.detail}>
          {/* Milestones */}
          <MilestoneList
            milestones={project.milestones || []}
            onToggle={(mid)        => toggleMilestone(project._docId, mid)}
            onAdd={(m)             => addMilestone(project._docId, m)}
            onDelete={(mid)        => deleteMilestone(project._docId, mid)}
            onUpdate={(mid, changes) => updateMilestone(project._docId, mid, changes)}
          />

          {/* Blockers */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionLabel}>Blockers</span>
              <button className={styles.addInlineBtn} onClick={() => setShowAddBlocker((v) => !v)}>
                {showAddBlocker ? <X size={12} /> : <Plus size={12} />}
              </button>
            </div>

            {showAddBlocker && (
              <form className={styles.inlineAddRow} onSubmit={handleAddBlocker}>
                <input
                  value={blockerText}
                  onChange={(e) => setBlockerText(e.target.value)}
                  placeholder="Describe the blocker…"
                  className={styles.inlineInput}
                  autoFocus
                />
                <button type="submit" className={styles.inlineSubmit}>Add</button>
              </form>
            )}

            {(project.blockers || []).length === 0 && !showAddBlocker && (
              <p className={styles.empty}>No blockers — all clear 🟢</p>
            )}

            <ul className={styles.blockerList}>
              {(project.blockers || []).map((b) => (
                <li key={b.id} className={`${styles.blockerItem} ${b.resolved ? styles.resolved : ''}`}>
                  <button className={styles.resolveBtn} onClick={() => toggleBlocker(project._docId, b.id)} title="Toggle resolved">
                    <CheckSquare size={13} />
                  </button>
                  <span className={styles.blockerText}>{b.text}</span>
                  <button className={styles.removeBtn} onClick={() => deleteBlocker(project._docId, b.id)}>
                    <X size={11} />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Update log */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionLabel}>
                <MessageSquare size={12} /> Updates
              </span>
              <button className={styles.addInlineBtn} onClick={() => setShowAddUpdate((v) => !v)}>
                {showAddUpdate ? <X size={12} /> : <Plus size={12} />}
              </button>
            </div>

            {showAddUpdate && (
              <form className={styles.inlineAddRow} onSubmit={handleAddUpdate}>
                <input
                  value={updateText}
                  onChange={(e) => setUpdateText(e.target.value)}
                  placeholder="What happened this week…"
                  className={styles.inlineInput}
                  autoFocus
                />
                <button type="submit" className={styles.inlineSubmit}>Log</button>
              </form>
            )}

            <ul className={styles.updateList}>
              {(project.updates || []).slice(0, 5).map((u) => (
                <li key={u.id} className={styles.updateItem}>
                  <span className={styles.updateDate}>{u.date}</span>
                  <span className={styles.updateText}>{u.text}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Danger zone */}
          <div className={styles.dangerRow}>
            <button className={styles.archiveBtn} onClick={() => archiveProject(project._docId)}>
              <Archive size={13} /> Archive
            </button>
            <button className={styles.deleteBtn} onClick={() => onDelete(project._docId)}>
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
