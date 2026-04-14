import { useState } from 'react';
import { Plus, Pencil, ChevronUp, ChevronDown, Check, X } from 'lucide-react';
import { useProjects } from '../../context/ProjectContext.jsx';
import styles from './PhaseTracker.module.css';
import sharedStyles from './Projects.module.css';

const STATUS_LABELS = {
  done:       'Done',
  inProgress: 'In Progress',
  notStarted: 'Not Started',
};

function PhaseRow({ phase, phases, projectId, index, total }) {
  const { updatePhase, deletePhase, reorderPhases } = useProjects();
  const [editing, setEditing]   = useState(false);
  const [expanded, setExpanded] = useState(phase.status !== 'done');
  const [form, setForm]         = useState({
    name:         phase.name || '',
    targetDate:   phase.targetDate || '',
    scopeCap:     phase.scopeCap || '',
    doneCriteria: (phase.doneCriteria || []).join('\n'),
    parallel:     phase.parallel || false,
  });

  const isDone    = phase.status === 'done';
  const isCurrent = phase.status === 'inProgress';

  const statusClass = isDone ? styles.statusDone
    : isCurrent        ? styles.statusInProgress
    :                    styles.statusNotStarted;

  async function handleMarkDone() {
    await updatePhase(projectId, phase.id, {
      status:     'done',
      actualDate: new Date().toISOString().slice(0, 10),
    });
  }

  async function handleMarkInProgress() {
    if (index > 0 && !phases[index - 1].parallel && phases[index - 1].status !== 'done') return;
    await updatePhase(projectId, phase.id, { status: 'inProgress' });
    setExpanded(true);
  }

  async function handleMarkNotStarted() {
    await updatePhase(projectId, phase.id, { status: 'notStarted', actualDate: null });
    setExpanded(true);
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    await updatePhase(projectId, phase.id, {
      name:         form.name.trim(),
      targetDate:   form.targetDate || null,
      scopeCap:     form.scopeCap.trim(),
      doneCriteria: form.doneCriteria.split('\n').map((s) => s.trim()).filter(Boolean),
      parallel:     form.parallel,
    });
    setEditing(false);
  }

  const rowClass = [
    styles.phaseRow,
    isDone    ? styles.rowDone    : '',
    isCurrent ? styles.rowCurrent : '',
  ].join(' ');

  return (
    <li className={rowClass}>
      {/* ── Collapsed / summary bar ── */}
      <div className={styles.rowHeader}>
        {/* Status icon */}
        <span className={styles.rowIcon}>
          {isDone ? <Check size={13} color="#00C896" /> : (
            <span className={styles.rowDot} style={{
              background: isCurrent ? '#F5A623' : '#444',
            }} />
          )}
        </span>

        {/* Phase number + name */}
        <button
          className={styles.rowTitle}
          onClick={() => !editing && setExpanded((v) => !v)}
        >
          <span className={styles.rowNum}>Phase {phase.number}</span>
          <span className={styles.rowName}>{phase.name}</span>
        </button>

        {/* Status badge */}
        <span className={`${styles.phaseBadge} ${statusClass}`}>
          {STATUS_LABELS[phase.status]}
        </span>

        {/* Reorder + Edit controls */}
        <div className={styles.rowControls}>
          <button
            className={styles.ctrlBtn}
            title="Move up"
            disabled={index === 0}
            onClick={() => reorderPhases(projectId, index, index - 1)}
          >
            <ChevronUp size={13} />
          </button>
          <button
            className={styles.ctrlBtn}
            title="Move down"
            disabled={index === total - 1}
            onClick={() => reorderPhases(projectId, index, index + 1)}
          >
            <ChevronDown size={13} />
          </button>
          <button
            className={styles.ctrlBtn}
            title="Edit phase"
            onClick={() => { setEditing((v) => !v); setExpanded(true); }}
          >
            <Pencil size={12} />
          </button>
        </div>
      </div>

      {/* ── Edit form ── */}
      {editing && (
        <form className={styles.editForm} onSubmit={handleSaveEdit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className={styles.editLabel}>Phase name *</label>
              <input
                className={sharedStyles.input}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
                autoFocus
              />
            </div>
            <div>
              <label className={styles.editLabel}>Target date</label>
              <input
                type="date"
                className={sharedStyles.input}
                value={form.targetDate}
                onChange={(e) => setForm((f) => ({ ...f, targetDate: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className={styles.editLabel}>Done criteria (one per line)</label>
            <textarea
              className={sharedStyles.input}
              rows={3}
              value={form.doneCriteria}
              onChange={(e) => setForm((f) => ({ ...f, doneCriteria: e.target.value }))}
              placeholder={'Fleet deployed\nApp live in zone'}
              style={{ resize: 'vertical' }}
            />
          </div>
          <div>
            <label className={styles.editLabel}>Scope cap (out-of-scope note)</label>
            <input
              className={sharedStyles.input}
              value={form.scopeCap}
              onChange={(e) => setForm((f) => ({ ...f, scopeCap: e.target.value }))}
              placeholder="This phase does NOT include…"
            />
          </div>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={form.parallel}
              onChange={(e) => setForm((f) => ({ ...f, parallel: e.target.checked }))}
            />
            <span>Parallel phase (can run simultaneously with previous)</span>
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
            <button
              type="button"
              className={styles.deleteTxt}
              onClick={() => {
                if (window.confirm(`Delete Phase ${phase.number}: ${phase.name}?`)) {
                  deletePhase(projectId, phase.id);
                }
              }}
            >
              Delete phase
            </button>
            <button type="button" className={sharedStyles.btnGhost} onClick={() => setEditing(false)}>
              <X size={13} /> Cancel
            </button>
            <button type="submit" className={sharedStyles.btnPrimary}>Save</button>
          </div>
        </form>
      )}

      {/* ── Expanded detail ── */}
      {!editing && expanded && (
        <div className={styles.rowDetail}>
          {/* Done criteria */}
          {phase.doneCriteria?.length > 0 && (
            <ul className={styles.doneCriteria}>
              {phase.doneCriteria.map((c, i) => (
                <li key={i} className={styles.doneCriteriaItem}>{c}</li>
              ))}
            </ul>
          )}

          {/* Dates */}
          <div className={styles.dateLine}>
            {phase.targetDate && <span>Target: {phase.targetDate}</span>}
            {phase.actualDate && <span style={{ color: '#00C896' }}>Completed: {phase.actualDate}</span>}
            {phase.parallel && <span className={styles.parallelTag}>Parallel</span>}
          </div>

          {/* Scope cap */}
          {phase.scopeCap && (
            <div className={styles.scopeCap}>{phase.scopeCap}</div>
          )}

          {/* Status actions */}
          <div className={styles.phaseActions}>
            {phase.status !== 'done' && (
              <button className={styles.phaseBtn} onClick={handleMarkDone}>✓ Mark Done</button>
            )}
            {phase.status === 'notStarted' && (
              <button className={styles.phaseBtn} onClick={handleMarkInProgress}>▶ Start</button>
            )}
            {phase.status === 'inProgress' && (
              <button className={styles.phaseBtn} onClick={handleMarkNotStarted}>↩ Reset</button>
            )}
            {phase.status === 'done' && (
              <button className={styles.phaseBtn} onClick={handleMarkNotStarted}>↩ Reopen</button>
            )}
          </div>
        </div>
      )}
    </li>
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
      name:         newPhase.name.trim(),
      targetDate:   newPhase.targetDate || null,
      scopeCap:     newPhase.scopeCap.trim(),
      doneCriteria: newPhase.doneCriteria.split('\n').map((s) => s.trim()).filter(Boolean),
    });
    setNewPhase({ name: '', targetDate: '', scopeCap: '', doneCriteria: '' });
    setShowForm(false);
  }

  return (
    <div className={styles.tracker}>
      {phases.length === 0 && !showForm && (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14, margin: 0 }}>
          No phases yet — add one below.
        </p>
      )}

      <ul className={styles.list}>
        {phases.map((ph, i) => (
          <PhaseRow
            key={ph.id}
            phase={ph}
            phases={phases}
            projectId={project._docId}
            index={i}
            total={phases.length}
          />
        ))}
      </ul>

      {showForm ? (
        <form className={styles.addPhaseForm} onSubmit={handleAddPhase}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className={styles.editLabel}>Phase name *</label>
              <input
                className={sharedStyles.input}
                placeholder="e.g. Fleet Deployment"
                value={newPhase.name}
                onChange={(e) => setNewPhase((f) => ({ ...f, name: e.target.value }))}
                required
                autoFocus
              />
            </div>
            <div>
              <label className={styles.editLabel}>Target date</label>
              <input
                type="date"
                className={sharedStyles.input}
                value={newPhase.targetDate}
                onChange={(e) => setNewPhase((f) => ({ ...f, targetDate: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className={styles.editLabel}>Done criteria (one per line)</label>
            <textarea
              className={sharedStyles.input}
              placeholder={'Fleet deployed\nApp live in zone'}
              value={newPhase.doneCriteria}
              onChange={(e) => setNewPhase((f) => ({ ...f, doneCriteria: e.target.value }))}
              rows={3}
              style={{ resize: 'vertical' }}
            />
          </div>
          <div>
            <label className={styles.editLabel}>Scope cap (optional)</label>
            <input
              className={sharedStyles.input}
              placeholder="This phase does NOT include…"
              value={newPhase.scopeCap}
              onChange={(e) => setNewPhase((f) => ({ ...f, scopeCap: e.target.value }))}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className={sharedStyles.btnGhost} onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className={sharedStyles.btnPrimary}>Add Phase</button>
          </div>
        </form>
      ) : (
        <button className={styles.addPhaseBtn} onClick={() => setShowForm(true)}>
          <Plus size={14} /> Add Phase
        </button>
      )}
    </div>
  );
}
