import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { useProjects } from '../../context/ProjectContext.jsx';
import { useCosts } from '../../context/CostContext.jsx';
import { useRevenue } from '../../context/RevenueContext.jsx';
import { budgetFromCity } from '../../utils/budgetFromCity.js';
import { daysSince, updateStaleness, relativeLabel } from '../../utils/powHelpers.js';
import { STATUS_CONFIG } from './constants.js';
import styles from './ProjectCard.module.css';

function ownerInitials(name) {
  if (!name) return '?';
  return name.slice(0, 2).toUpperCase();
}

function currentPhase(phases) {
  if (!phases?.length) return null;
  return phases.find((p) => p.status === 'inProgress') ||
         phases.find((p) => p.status === 'notStarted') ||
         phases[phases.length - 1];
}

export default function ProjectCard({ project }) {
  const navigate = useNavigate();
  const { setNextAction } = useProjects();
  const { costs } = useCosts();
  const { revenueData } = useRevenue();

  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');

  const status = project.effectiveStatus || 'onTrack';
  const statusCfg = STATUS_CONFIG[status] || STATUS_CONFIG.onTrack;
  const phases = project.phases || [];
  const active = currentPhase(phases);
  const doneCount = phases.filter((p) => p.status === 'done').length;

  // Budget
  const { expenses, revenue, net } = budgetFromCity(costs, revenueData, project.linkedCity);
  const hasBudget = project.plannedBudget > 0;
  const budgetPct = hasBudget ? Math.min((expenses / project.plannedBudget) * 100, 100) : 0;
  const budgetColor = budgetPct >= 90 ? '#E84545' : budgetPct >= 70 ? '#F5A623' : '#00C896';

  // Staleness
  const staleness = updateStaleness(project.updatedAt);
  const daysAgo = project.updatedAt ? daysSince(project.updatedAt) : null;

  function handleCardClick(e) {
    if (editing) return;
    navigate(`/projects/${project._docId}`);
  }

  function handleNextActionClick(e) {
    e.stopPropagation();
    setEditText(project.nextAction?.text || '');
    setEditing(true);
  }

  async function handleNextActionSave(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!editText.trim()) { setEditing(false); return; }
    await setNextAction(project._docId, {
      text: editText.trim(),
      dueDate: project.nextAction?.dueDate || null,
      owner: project.nextAction?.owner || project.owner || 'Kostas',
    });
    setEditing(false);
  }

  function handleInputKeyDown(e) {
    if (e.key === 'Escape') { setEditing(false); }
  }

  const statusClass = status === 'blocked' ? styles.statusBlocked
    : status === 'needsAttention' ? styles.statusNeeds
    : styles.statusOnTrack;

  return (
    <div
      className={`${styles.card} ${statusClass}`}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleCardClick(e)}
    >
      {/* Row 1: status dot + name + owner */}
      <div className={styles.topRow}>
        <span className={styles.statusDot} style={{ background: statusCfg.color }} />
        <h3 className={styles.projectName}>{project.name}</h3>
        {project.archived && <span className={styles.archivedChip}>Archived</span>}
        <div className={styles.ownerAvatar} title={project.owner}>
          {ownerInitials(project.owner)}
        </div>
      </div>

      {/* Row 2: phase progress */}
      {phases.length > 0 && (
        <div className={styles.phaseRow}>
          <span className={styles.phaseCounter}>
            Phase {doneCount + (active?.status === 'inProgress' ? 1 : doneCount < phases.length ? doneCount + 1 : doneCount)} of {phases.length}
          </span>
          <div className={styles.phaseDots}>
            {phases.map((ph, i) => {
              const cls = ph.status === 'done' ? styles.done
                : ph.status === 'inProgress' ? styles.current
                : '';
              return <span key={ph.id || i} className={`${styles.phaseDot} ${cls}`} />;
            })}
          </div>
          {active && (
            <span className={styles.phaseNameLabel}>{active.name}</span>
          )}
        </div>
      )}

      <hr className={styles.divider} />

      {/* Row 3: next action */}
      <div className={styles.nextActionRow} onClick={(e) => e.stopPropagation()}>
        <span className={styles.nextArrow}>→</span>
        {editing ? (
          <form style={{ flex: 1 }} onSubmit={handleNextActionSave}>
            <input
              className={styles.nextActionInput}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="Next action…"
              autoFocus
            />
          </form>
        ) : project.nextAction?.text ? (
          <span
            className={styles.nextActionText}
            title="Click to edit"
            onClick={handleNextActionClick}
          >
            {project.nextAction.text}
          </span>
        ) : (
          <span className={styles.noNextAction} onClick={handleNextActionClick}>
            <AlertTriangle size={12} /> No next action set
          </span>
        )}
      </div>

      <hr className={styles.divider} />

      {/* Row 4: budget + staleness */}
      <div className={styles.bottomRow}>
        {hasBudget ? (
          <div className={styles.budgetStrip}>
            <span className={`${styles.budgetLabel} ${budgetPct >= 90 ? styles.budgetLabelRed : budgetPct >= 70 ? styles.budgetLabelAmber : ''}`}>
              €{expenses.toLocaleString('el-GR')} / €{project.plannedBudget.toLocaleString('el-GR')}
            </span>
            <div className={styles.budgetBar}>
              <div
                className={styles.budgetFill}
                style={{ width: `${budgetPct}%`, background: budgetColor }}
              />
            </div>
          </div>
        ) : (
          <span />
        )}
        <span className={`${styles.staleLabel} ${staleness === 'red' ? styles.staleRed : staleness === 'amber' ? styles.staleAmber : ''}`}>
          {daysAgo === null ? '—'
            : daysAgo === 0 ? 'Updated today'
            : `Updated ${relativeLabel(project.updatedAt)}`}
        </span>
      </div>
    </div>
  );
}
