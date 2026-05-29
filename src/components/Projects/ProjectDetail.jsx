import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronDown, ChevronUp, Link2, X, Pencil } from 'lucide-react';
import { useProjects } from '../../context/ProjectContext.jsx';
import { STATUS_CONFIG, OWNERS, PROJECT_TYPES, CATEGORIES } from './constants.js';
import PhaseTracker from './PhaseTracker.jsx';
import NextActionPanel from './NextActionPanel.jsx';
import BlockersPanel from './BlockersPanel.jsx';
import BudgetTracker from './BudgetTracker.jsx';
import DecisionLog from './DecisionLog.jsx';
import PowHistory from './PowHistory.jsx';
import CriticalPathPanel from './CriticalPathPanel.jsx';
import styles from './ProjectDetail.module.css';

// ── Inline text editor (click-to-edit) ───────────────────────────────────────
function InlineText({ value, onSave, placeholder, className, multiline = false, large = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value || '');
  const ref = useRef(null);
  const committedRef = useRef(false);

  // Only sync external value when not actively editing (#199)
  useEffect(() => { if (!editing) setDraft(value || ''); }, [value, editing]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);
  // Reset committed guard when editing ends (#200)
  useEffect(() => { if (!editing) committedRef.current = false; }, [editing]);

  function commit() {
    // Guard against double-commit on Enter + blur (#200)
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = draft.trim();
    if (trimmed !== (value || '').trim()) onSave(trimmed);
    setEditing(false);
  }

  function handleKey(e) {
    if (!multiline && e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { setDraft(value || ''); setEditing(false); }
  }

  if (editing) {
    const shared = {
      ref,
      value: draft,
      onChange: (e) => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: handleKey,
      className: large ? styles.inlineInputLarge : styles.inlineInput,
      placeholder,
    };
    return multiline
      ? <textarea rows={2} {...shared} style={{ resize: 'vertical', width: '100%' }} />
      : <input type="text" {...shared} />;
  }

  return (
    <button
      className={`${styles.inlineDisplay} ${className || ''} ${!value ? styles.inlinePlaceholder : ''}`}
      onClick={() => setEditing(true)}
      title="Click to edit"
    >
      {value || placeholder || 'Click to edit…'}
      <Pencil size={12} className={styles.inlinePencil} />
    </button>
  );
}

// ── Inline select editor ──────────────────────────────────────────────────────
function InlineSelect({ value, options, onSave, placeholder }) {
  return (
    <select
      className={styles.metaSelect}
      value={value || ''}
      onChange={(e) => onSave(e.target.value || null)}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
      ))}
    </select>
  );
}

// ── Inline date editor ────────────────────────────────────────────────────────
function InlineDate({ value, onSave, label }) {
  return (
    <label className={styles.metaDateWrap}>
      <span className={styles.metaDateLabel}>{label}</span>
      <input
        type="date"
        className={styles.metaDateInput}
        value={value || ''}
        onChange={(e) => onSave(e.target.value || null)}
      />
    </label>
  );
}

// ── Related Projects strip ────────────────────────────────────────────────────
function RelatedProjects({ project }) {
  const navigate = useNavigate();
  const { activeProjects, linkProjects, unlinkProjects } = useProjects();
  const [showLinkPicker, setShowLinkPicker] = useState(false);

  const parent   = project.parentProjectId
    ? activeProjects.find((p) => p._docId === project.parentProjectId)
    : null;
  const children = (project.phases || [])
    .filter((ph) => ph.childProjectId)
    .map((ph) => ({ phase: ph, child: activeProjects.find((p) => p._docId === ph.childProjectId) }))
    .filter((x) => x.child);
  const linked   = (project.linkedProjectIds || [])
    .filter((id) => id !== project.parentProjectId && !children.some((c) => c.child._docId === id))
    .map((id) => activeProjects.find((p) => p._docId === id))
    .filter(Boolean);

  const linkCandidates = activeProjects.filter(
    (p) =>
      p._docId !== project._docId &&
      !(project.linkedProjectIds || []).includes(p._docId) &&
      p._docId !== project.parentProjectId,
  );

  const hasAny = parent || children.length > 0 || linked.length > 0;

  return (
    <div style={{ marginTop: 12 }}>
      {hasAny && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          {parent && (
            <button style={chipStyle('#6B7280')} onClick={() => navigate(`/projects/${parent._docId}`)}>
              ↑ {parent.name}
            </button>
          )}
          {children.map(({ phase: _phase, child }) => (
            <button key={child._docId} style={chipStyle('#C97D49')} onClick={() => navigate(`/projects/${child._docId}`)}>
              ↓ {child.name}
            </button>
          ))}
          {linked.map((p) => (
            <span key={p._docId} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              <button style={chipStyle('#3B82F6')} onClick={() => navigate(`/projects/${p._docId}`)}>⟷ {p.name}</button>
              <button onClick={() => unlinkProjects(project._docId, p._docId)} title="Unlink" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: '0 2px', fontSize: 12 }}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      {showLinkPicker ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 6, color: 'var(--color-text-primary)', padding: '5px 10px', fontSize: 13, cursor: 'pointer' }}
            defaultValue=""
            onChange={async (e) => { if (e.target.value) { await linkProjects(project._docId, e.target.value); setShowLinkPicker(false); } }}
          >
            <option value="">— select project —</option>
            {linkCandidates.map((p) => <option key={p._docId} value={p._docId}>{p.name}</option>)}
          </select>
          <button onClick={() => setShowLinkPicker(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4 }}>
            <X size={13} />
          </button>
        </div>
      ) : (
        <button onClick={() => setShowLinkPicker(true)} style={{ background: 'none', border: '1px dashed var(--color-border)', borderRadius: 6, color: 'var(--color-text-muted)', fontSize: 12, padding: '4px 10px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Link2 size={12} /> Link project
        </button>
      )}
    </div>
  );
}

function chipStyle(color) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3px 10px', borderRadius: 20,
    background: `color-mix(in srgb, ${color} 12%, transparent)`,
    border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
    color, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
  };
}

// ── Activity log ──────────────────────────────────────────────────────────────
function ActivityLog({ updates }) {
  if (!updates?.length) return <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No activity yet.</p>;
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {updates.map((u) => (
        <li key={u.id} style={{ display: 'flex', gap: 12, fontSize: 13, borderBottom: '1px solid var(--color-border-subtle)', paddingBottom: 8 }}>
          <span style={{ color: 'var(--color-text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>{u.date}</span>
          <span style={{ color: 'var(--color-text-secondary)' }}>{u.text}</span>
        </li>
      ))}
    </ul>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ProjectDetail({ projectId }) {
  const navigate = useNavigate();
  const { projects, setStatus, updateProject, archiveProject, deleteProject, unarchiveProject } = useProjects();
  const [dangerOpen, setDangerOpen] = useState(false);

  const project = projects.find((p) => p._docId === projectId);

  if (!project) {
    return (
      <div className={styles.notFound}>
        <p>Project not found.</p>
        <button onClick={() => navigate('/projects')} style={{ color: 'var(--color-primary-light)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>
          ← Back to Projects
        </button>
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[project.effectiveStatus] || STATUS_CONFIG.onTrack;

  function save(field) {
    return (value) => updateProject(project._docId, { [field]: value });
  }

  async function handleArchive() {
    project.archived ? await unarchiveProject(project._docId) : await archiveProject(project._docId);
    if (!project.archived) navigate('/projects');
  }

  const phases = project.phases || [];
  const donePhases = phases.filter((p) => p.status === 'done').length;

  return (
    <div className={styles.page}>
      {/* ── Back button ── */}
      <button className={styles.backBtn} onClick={() => navigate('/projects')}>
        <ChevronLeft size={16} /> Projects
      </button>

      {/* ── Project Header ── */}
      <div className={styles.headerRow}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <InlineText
            value={project.name}
            onSave={save('name')}
            placeholder="Project name"
            className={styles.projectTitle}
            large
          />
          <InlineText
            value={project.tagline}
            onSave={save('tagline')}
            placeholder="Add a one-line tagline…"
            className={styles.tagline}
          />
        </div>
        <div className={styles.headerActions}>
          <select
            className={styles.statusSelect}
            value={project.status}
            onChange={(e) => setStatus(project._docId, e.target.value)}
            style={{ borderLeft: `3px solid ${statusCfg.color}` }}
          >
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>{v.dot} {v.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Editable meta row ── */}
      <div className={styles.metaGrid}>
        <InlineDate label="Start" value={project.startDate} onSave={save('startDate')} />
        <InlineDate label="Target" value={project.targetDate} onSave={save('targetDate')} />

        <label className={styles.metaSelectWrap}>
          <span className={styles.metaDateLabel}>Owner</span>
          <InlineSelect
            value={project.owner}
            options={OWNERS}
            onSave={save('owner')}
          />
        </label>

        <label className={styles.metaSelectWrap}>
          <span className={styles.metaDateLabel}>Type</span>
          <InlineSelect
            value={project.projectType}
            options={PROJECT_TYPES}
            onSave={save('projectType')}
            placeholder="— type —"
          />
        </label>

        <label className={styles.metaSelectWrap}>
          <span className={styles.metaDateLabel}>Category</span>
          <InlineSelect
            value={project.category}
            options={CATEGORIES}
            onSave={save('category')}
            placeholder="— category —"
          />
        </label>

        {phases.length > 0 && (
          <span className={styles.metaPill}>
            Phase {donePhases + 1} / {phases.length}
          </span>
        )}
      </div>

      {/* ── Related Projects ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Related Projects</h2>
        </div>
        <RelatedProjects project={project} />
      </section>

      {/* ── Phase Tracker ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Phases</h2>
        </div>
        <PhaseTracker project={project} />
      </section>

      {/* ── Critical Path Analysis ── */}
      {phases.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Critical Path Analysis</h2>
          </div>
          <CriticalPathPanel project={project} />
        </section>
      )}

      {/* ── Next Action ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Next Action</h2>
        </div>
        <NextActionPanel project={project} />
      </section>

      {/* ── Blockers ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Blockers</h2>
          {(project.blockers || []).filter((b) => !b.resolved).length > 0 && (
            <span style={{ fontSize: 12, color: '#E84545', fontWeight: 700 }}>
              {(project.blockers || []).filter((b) => !b.resolved).length} active
            </span>
          )}
        </div>
        <BlockersPanel project={project} />
      </section>

      {/* ── Budget ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Budget</h2>
        </div>
        <BudgetTracker project={project} />
      </section>

      {/* ── Decision Log ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Decision Log</h2>
        </div>
        <DecisionLog project={project} />
      </section>

      {/* ── POW History ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>POW — Progress of Week</h2>
        </div>
        <PowHistory project={project} />
      </section>

      {/* ── Activity Log ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Activity Log</h2>
        </div>
        <ActivityLog updates={project.updates} />
      </section>

      {/* ── Description + Tags (collapsible, low-priority fields) ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Description & Tags</h2>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>Description</label>
            <InlineText
              value={project.description}
              onSave={save('description')}
              placeholder="Add a longer description…"
              multiline
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>Tags (comma-separated)</label>
            <input
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 6, color: 'var(--color-text-primary)', padding: '6px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box' }}
              defaultValue={(project.tags || []).join(', ')}
              onBlur={(e) => {
                const tags = e.target.value.split(',').map((t) => t.trim()).filter(Boolean);
                updateProject(project._docId, { tags });
              }}
              placeholder="xslide, nafplion, operations"
            />
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            Created: {project.createdAt?.toDate ? project.createdAt.toDate().toLocaleDateString('en-GB') : '—'}
          </div>
        </div>
      </section>

      {/* ── Danger zone ── */}
      <div>
        <button className={styles.metadataToggle} onClick={() => setDangerOpen((v) => !v)}>
          {dangerOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Danger zone
        </button>
        {dangerOpen && (
          <section className={styles.section}>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={handleArchive}
                style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 6, color: 'var(--color-text-muted)', fontSize: 13, padding: '6px 14px', cursor: 'pointer' }}
              >
                {project.archived ? 'Unarchive project' : 'Archive project'}
              </button>
              <button
                onClick={async () => {
                  if (window.confirm(`Delete "${project.name}"? This cannot be undone.`)) {
                    await deleteProject(project._docId);
                    navigate('/projects');
                  }
                }}
                style={{ background: 'none', border: '1px solid #E84545', borderRadius: 6, color: '#E84545', fontSize: 13, padding: '6px 14px', cursor: 'pointer' }}
              >
                Delete project
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
