import { useState } from 'react';
import { Plus, Check } from 'lucide-react';
import { useProjects } from '../../context/ProjectContext.jsx';
import styles from './PhaseTracker.module.css';
import sharedStyles from './Projects.module.css';

const STATUS_LABELS = {
  done: 'Done',
  inProgress: 'In Progress',
  notStarted: 'Not Started',
};

function PhaseCard({ phase, phases, projectId, index }) {
  const { updatePhase, deletePhase } = useProjects();
  const isDone = phase.status === 'done';
  const isCurrent = phase.status === 'inProgress';
  const isCollapsed = isDone;

  const cardClass = `${styles.phaseCard} ${isDone ? styles.done : isCurrent ? styles.current : ''} ${isCollapsed ? styles.collapsed : ''}`;
  const statusClass = isDone ? styles.statusDone : isCurrent ? styles.statusInProgress : styles.statusNotStarted;

  async function handleMarkDone() {
    await updatePhase(projectId, phase.id, {
      status: 'done',
      actualDate: new Date().toISOString().slice(0, 10),
    });
  }

  async function handleMarkInProgress() {
    // Enforce sequential: previous phase must be done (unless parallel)
    if (index > 0 && !phases[index - 1].parallel && phases[index - 1].status !== 'done') return;
    await updatePhase(projectId, phase.id, { status: 'inProgress' });
  }

  async function handleMarkNotStarted() {
    await updatePhase(projectId, phase.id, { status: 'notStarted', actualDate: null });
  }

  if (isCollapsed) {
    return (
      <div className={cardClass}>
        <Check size={14} color="#00C896" />
        <span className={styles.phaseName} style={{ fontSize: 13, opacity: 0.8 }}>
          Phase {phase.number}: {phase.name}
        </span>
        <span className={`${styles.phaseStatus} ${statusClass}`}>{STATUS_LABELS[phase.status]}</span>
      </div>
    );
  }

  return (
    <div className={cardClass}>
      <div className={styles.phaseNum}>Phase {phase.number}</div>
      <h4 className={styles.phaseName}>{phase.name}</h4>
      <span className={`${styles.phaseStatus} ${statusClass}`}>{STATUS_LABELS[phase.status]}</span>

      {phase.targetDate && (
        <span className={styles.phaseDate}>Target: {phase.targetDate}</span>
      )}
      {phase.actualDate && (
        <span className={styles.phaseDate} style={{ color: '#00C896' }}>Completed: {phase.actualDate}</span>
      )}

      {phase.doneCriteria?.length > 0 && (
        <ul className={styles.doneCriteria}>
          {phase.doneCriteria.map((c, i) => (
            <li key={i} className={styles.doneCriteriaItem}>{c}</li>
          ))}
        </ul>
      )}

      {phase.scopeCap && (
        <div className={styles.scopeCap}>{phase.scopeCap}</div>
      )}

      <div className={styles.phaseActions}>
        {phase.status !== 'done' && (
          <button className={styles.phaseBtn} onClick={handleMarkDone} title="Mark done">
            ✓ Done
          </button>
        )}
        {phase.status === 'notStarted' && (
          <button className={styles.phaseBtn} onClick={handleMarkInProgress}>
            Start
          </button>
        )}
        {phase.status === 'inProgress' && (
          <button className={styles.phaseBtn} onClick={handleMarkNotStarted}>
            ← Reset
          </button>
        )}
        {phase.status === 'done' && (
          <button className={styles.phaseBtn} onClick={handleMarkNotStarted}>
            ← Reopen
          </button>
        )}
        <button
          className={`${styles.phaseBtn} ${styles.danger}`}
          onClick={() => deletePhase(projectId, phase.id)}
          title="Delete phase"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export default function PhaseTracker({ project }) {
  const { addPhase } = useProjects();
  const [showForm, setShowForm] = useState(false);
  const [newPhase, setNewPhase] = useState({ name: '', targetDate: '', scopeCap: '', doneCriteria: '' });

  const phases = project.phases || [];

  async function handleAddPhase(e) {
    e.preventDefault();
    if (!newPhase.name.trim()) return;
    await addPhase(project._docId, {
      name: newPhase.name.trim(),
      targetDate: newPhase.targetDate || null,
      scopeCap: newPhase.scopeCap.trim(),
      doneCriteria: newPhase.doneCriteria
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    });
    setNewPhase({ name: '', targetDate: '', scopeCap: '', doneCriteria: '' });
    setShowForm(false);
  }

  return (
    <div className={styles.tracker}>
      <div className={styles.timeline}>
        {phases.map((ph, i) => (
          <PhaseCard
            key={ph.id}
            phase={ph}
            phases={phases}
            projectId={project._docId}
            index={i}
          />
        ))}

        <button className={styles.addPhaseBtn} onClick={() => setShowForm((v) => !v)}>
          <Plus size={14} /> Add Phase
        </button>
      </div>

      {showForm && (
        <form className={styles.addPhaseForm} onSubmit={handleAddPhase}>
          <input
            className={sharedStyles.input}
            placeholder="Phase name *"
            value={newPhase.name}
            onChange={(e) => setNewPhase((f) => ({ ...f, name: e.target.value }))}
            required
            autoFocus
          />
          <input
            type="date"
            className={sharedStyles.input}
            value={newPhase.targetDate}
            onChange={(e) => setNewPhase((f) => ({ ...f, targetDate: e.target.value }))}
            placeholder="Target date"
          />
          <textarea
            className={sharedStyles.input}
            placeholder={'Done criteria (one per line)\ne.g. Fleet deployed\nApp live'}
            value={newPhase.doneCriteria}
            onChange={(e) => setNewPhase((f) => ({ ...f, doneCriteria: e.target.value }))}
            rows={3}
            style={{ resize: 'vertical' }}
          />
          <input
            className={sharedStyles.input}
            placeholder="Out of scope (optional scope cap)"
            value={newPhase.scopeCap}
            onChange={(e) => setNewPhase((f) => ({ ...f, scopeCap: e.target.value }))}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className={sharedStyles.btnGhost} onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className={sharedStyles.btnPrimary}>Add Phase</button>
          </div>
        </form>
      )}
    </div>
  );
}
