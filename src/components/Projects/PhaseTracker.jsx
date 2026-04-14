import { useState } from 'react';
import { Plus, Pencil, ChevronUp, ChevronDown, Check, X, Trash2 } from 'lucide-react';
import { useProjects } from '../../context/ProjectContext.jsx';
import styles from './PhaseTracker.module.css';
import sharedStyles from './Projects.module.css';

const STATUS_LABELS = {
  done:       'Done',
  inProgress: 'In Progress',
  notStarted: 'Not Started',
};

function TaskList({ phase, projectId }) {
  const { updatePhase } = useProjects();
  const [newTask, setNewTask] = useState('');

  const tasks = phase.tasks || [];

  async function handleToggle(taskId) {
    const updated = tasks.map((t) => t.id === taskId ? { ...t, done: !t.done } : t);
    await updatePhase(projectId, phase.id, { tasks: updated });
  }

  async function handleRemove(taskId) {
    const updated = tasks.filter((t) => t.id !== taskId);
    await updatePhase(projectId, phase.id, { tasks: updated });
  }

  async function handleAdd(e) {
    e.preventDefault();
    const text = newTask.trim();
    if (!text) return;
    const updated = [...tasks, { id: crypto.randomUUID(), text, done: false }];
    await updatePhase(projectId, phase.id, { tasks: updated });
    setNewTask('');
  }

  return (
    <div className={styles.taskSection}>
      <div className={styles.taskSectionHeader}>
        <span>Tasks</span>
        {tasks.length > 0 && (
          <span className={`${styles.taskPill} ${tasks.every((t) => t.done) ? styles.taskPillDone : ''}`}>
            {tasks.filter((t) => t.done).length}/{tasks.length} done
          </span>
        )}
      </div>

      {tasks.length > 0 && (
        <ul className={styles.taskList}>
          {tasks.map((task) => (
            <li key={task.id} className={styles.taskItem}>
              <button
                className={`${styles.taskCheck} ${task.done ? styles.taskCheckDone : ''}`}
                onClick={() => handleToggle(task.id)}
                title={task.done ? 'Mark incomplete' : 'Mark complete'}
              >
                {task.done && <Check size={10} />}
              </button>
              <span className={`${styles.taskText} ${task.done ? styles.taskTextDone : ''}`}>
                {task.text}
              </span>
              <button className={styles.taskRemove} onClick={() => handleRemove(task.id)} title="Remove task">
                <X size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className={styles.addTaskForm} onSubmit={handleAdd}>
        <input
          className={styles.addTaskInput}
          placeholder="Add a task…"
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
        />
        <button type="submit" className={styles.addTaskBtn} disabled={!newTask.trim()}>
          <Plus size={13} />
        </button>
      </form>
    </div>
  );
}

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

  const tasks      = phase.tasks || [];
  const doneTasks  = tasks.filter((t) => t.done).length;
  const allDone    = tasks.length > 0 && doneTasks === tasks.length;
  const pendingCount = tasks.length - doneTasks;

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
    // Fix: check current phase's parallel flag, not previous phase's
    if (index > 0 && !phase.parallel && phases[index - 1].status !== 'done') return;
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
    isDone      ? styles.rowDone    : '',
    isCurrent   ? styles.rowCurrent : '',
    phase.parallel && index > 0 ? styles.rowParallel : '',
  ].join(' ');

  return (
    <li className={rowClass}>
      {/* Parallel connector line */}
      {phase.parallel && index > 0 && (
        <div className={styles.parallelConnector}>
          <span className={styles.parallelLabel}>runs in parallel</span>
        </div>
      )}

      {/* ── Summary bar ── */}
      <div className={styles.rowHeader}>
        <span className={styles.rowIcon}>
          {isDone ? <Check size={13} color="#00C896" /> : (
            <span className={styles.rowDot} style={{ background: isCurrent ? '#F5A623' : '#444' }} />
          )}
        </span>

        <button
          className={styles.rowTitle}
          onClick={() => !editing && setExpanded((v) => !v)}
        >
          <span className={styles.rowNum}>Phase {phase.number}</span>
          <span className={styles.rowName}>{phase.name}</span>
        </button>

        {/* Task count badge */}
        {tasks.length > 0 && (
          <span className={`${styles.taskCountBadge} ${allDone ? styles.taskCountBadgeDone : ''}`}>
            {doneTasks}/{tasks.length}
          </span>
        )}

        <span className={`${styles.phaseBadge} ${statusClass}`}>
          {STATUS_LABELS[phase.status]}
        </span>

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
            <label className={styles.editLabel}>Acceptance criteria (one per line — displayed as green ✓)</label>
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
            <span>Parallel — runs simultaneously with previous phase</span>
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
              <Trash2 size={12} /> Delete phase
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
          {/* Acceptance criteria */}
          {phase.doneCriteria?.length > 0 && (
            <ul className={styles.doneCriteria}>
              {phase.doneCriteria.map((c, i) => (
                <li key={i} className={styles.doneCriteriaItem}>{c}</li>
              ))}
            </ul>
          )}

          {/* Interactive task checklist */}
          <TaskList phase={phase} projectId={projectId} />

          {/* Dates + parallel tag */}
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
              <button className={styles.phaseBtn} onClick={handleMarkDone}>
                ✓ Mark Done
                {pendingCount > 0 && (
                  <span className={styles.pendingWarn}> ({pendingCount} task{pendingCount > 1 ? 's' : ''} pending)</span>
                )}
              </button>
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
  const [newPhase, setNewPhase] = useState({
    name: '', targetDate: '', scopeCap: '', doneCriteria: '', parallel: false,
  });

  const phases = project.phases || [];

  async function handleAddPhase(e) {
    e.preventDefault();
    if (!newPhase.name.trim()) return;
    await addPhase(project._docId, {
      name:         newPhase.name.trim(),
      targetDate:   newPhase.targetDate || null,
      scopeCap:     newPhase.scopeCap.trim(),
      doneCriteria: newPhase.doneCriteria.split('\n').map((s) => s.trim()).filter(Boolean),
      parallel:     newPhase.parallel,
      tasks:        [],
    });
    setNewPhase({ name: '', targetDate: '', scopeCap: '', doneCriteria: '', parallel: false });
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
            <label className={styles.editLabel}>Acceptance criteria (one per line)</label>
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
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={newPhase.parallel}
              onChange={(e) => setNewPhase((f) => ({ ...f, parallel: e.target.checked }))}
            />
            <span>Parallel — runs simultaneously with previous phase</span>
          </label>
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
