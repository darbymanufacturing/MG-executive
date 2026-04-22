import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronDown, ChevronUp, Link2, X } from 'lucide-react';
import { useProjects } from '../../context/ProjectContext.jsx';
import { STATUS_CONFIG, OWNERS, PROJECT_TYPES, CITIES, CATEGORIES } from './constants.js';
import PhaseTracker from './PhaseTracker.jsx';
import NextActionPanel from './NextActionPanel.jsx';
import BlockersPanel from './BlockersPanel.jsx';
import BudgetTracker from './BudgetTracker.jsx';
import DecisionLog from './DecisionLog.jsx';
import PowHistory from './PowHistory.jsx';
import styles from './ProjectDetail.module.css';

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
            <button
              style={chipStyle('#6B7280')}
              onClick={() => navigate(`/projects/${parent._docId}`)}
              title="Parent project"
            >
              ↑ {parent.name}
            </button>
          )}
          {children.map(({ phase, child }) => (
            <button
              key={child._docId}
              style={chipStyle('#C97D49')}
              onClick={() => navigate(`/projects/${child._docId}`)}
              title={`Sub-project from ${phase.name}`}
            >
              ↓ {child.name}
            </button>
          ))}
          {linked.map((p) => (
            <span key={p._docId} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              <button style={chipStyle('#3B82F6')} onClick={() => navigate(`/projects/${p._docId}`)}>
                ⟷ {p.name}
              </button>
              <button
                onClick={() => unlinkProjects(project._docId, p._docId)}
                title="Unlink"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: '0 2px', fontSize: 12 }}
              >
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
            onChange={async (e) => {
              if (e.target.value) {
                await linkProjects(project._docId, e.target.value);
                setShowLinkPicker(false);
              }
            }}
          >
            <option value="">— select project —</option>
            {linkCandidates.map((p) => (
              <option key={p._docId} value={p._docId}>{p.name}</option>
            ))}
          </select>
          <button onClick={() => setShowLinkPicker(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4 }}>
            <X size={13} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowLinkPicker(true)}
          style={{ background: 'none', border: '1px dashed var(--color-border)', borderRadius: 6, color: 'var(--color-text-muted)', fontSize: 12, padding: '4px 10px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
        >
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
    color, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

export default function ProjectDetail({ projectId }) {
  const navigate = useNavigate();
  const { projects, setStatus, updateProject, archiveProject, deleteProject } = useProjects();
  const [metaOpen, setMetaOpen] = useState(false);

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

  async function handleStatusChange(e) {
    await setStatus(project._docId, e.target.value);
  }

  async function handleArchive() {
    await archiveProject(project._docId);
    navigate('/projects');
  }

  return (
    <div className={styles.page}>
      {/* ── Back button ── */}
      <button className={styles.backBtn} onClick={() => navigate('/projects')}>
        <ChevronLeft size={16} /> Projects
      </button>

      {/* ── §3.1 Project Header ── */}
      <div className={styles.headerRow}>
        <h1 className={styles.projectTitle}>{project.name}</h1>
        <div className={styles.headerActions}>
          <select
            className={styles.statusSelect}
            value={project.status}
            onChange={handleStatusChange}
            style={{ borderLeft: `3px solid ${statusCfg.color}` }}
          >
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>{v.dot} {v.label}</option>
            ))}
          </select>
          <div className={styles.ownerBadge}>
            <div className={styles.ownerDot}>
              {(project.owner || '?').slice(0, 2).toUpperCase()}
            </div>
            {project.owner}
          </div>
        </div>
      </div>

      {project.tagline && <p className={styles.tagline}>{project.tagline}</p>}

      <div className={styles.metaRow}>
        {project.startDate && (
          <span className={styles.metaItem}>Start: {project.startDate}</span>
        )}
        {project.targetDate && (
          <span className={styles.metaItem}>Target: {project.targetDate}</span>
        )}
        {(project.phases || []).length > 0 && (
          <span className={styles.metaItem}>
            Phase {(project.phases.filter((p) => p.status === 'done').length) + 1} of {project.phases.length}
          </span>
        )}
        {project.projectType && (
          <span className={styles.metaItem}>{project.projectType}</span>
        )}
      </div>

      {/* ── Related Projects ── */}
      <section className={styles.section} style={{ paddingTop: 12, paddingBottom: 12 }}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Related Projects</h2>
        </div>
        <RelatedProjects project={project} />
      </section>

      {/* ── §3.2 Phase Tracker ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Phases</h2>
        </div>
        <PhaseTracker project={project} />
      </section>

      {/* ── §3.3 Next Action ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Next Action</h2>
        </div>
        <NextActionPanel project={project} />
      </section>

      {/* ── §3.4 Blockers ── */}
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

      {/* ── §3.5 Budget Tracker ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Budget</h2>
        </div>
        <BudgetTracker project={project} />
      </section>

      {/* ── §3.6 Decision Log ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Decision Log</h2>
        </div>
        <DecisionLog project={project} />
      </section>

      {/* ── §3.7 POW History ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>POW — Progress of Week</h2>
        </div>
        <PowHistory project={project} />
      </section>

      {/* ── §3.8 Activity Log ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Activity Log</h2>
        </div>
        <ActivityLog updates={project.updates} />
      </section>

      {/* ── §3.8 Project Metadata (collapsible footer) ── */}
      <div>
        <button className={styles.metadataToggle} onClick={() => setMetaOpen((v) => !v)}>
          {metaOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Project details & settings
        </button>

        {metaOpen && (
          <section className={styles.section}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>Owner</label>
                <select
                  style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 6, color: 'var(--color-text-primary)', padding: '6px 10px', fontSize: 13, width: '100%', cursor: 'pointer' }}
                  value={project.owner || ''}
                  onChange={(e) => updateProject(project._docId, { owner: e.target.value })}
                >
                  {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>Type</label>
                <select
                  style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 6, color: 'var(--color-text-primary)', padding: '6px 10px', fontSize: 13, width: '100%', cursor: 'pointer' }}
                  value={project.projectType || ''}
                  onChange={(e) => updateProject(project._docId, { projectType: e.target.value })}
                >
                  {PROJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>Category</label>
                <select
                  style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 6, color: 'var(--color-text-primary)', padding: '6px 10px', fontSize: 13, width: '100%', cursor: 'pointer' }}
                  value={project.category || ''}
                  onChange={(e) => updateProject(project._docId, { category: e.target.value })}
                >
                  <option value="">— no category —</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>Start date</label>
                <input
                  type="date"
                  style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 6, color: 'var(--color-text-primary)', padding: '6px 10px', fontSize: 13, width: '100%' }}
                  defaultValue={project.startDate || ''}
                  onBlur={(e) => updateProject(project._docId, { startDate: e.target.value })}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>Target date</label>
                <input
                  type="date"
                  style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 6, color: 'var(--color-text-primary)', padding: '6px 10px', fontSize: 13, width: '100%' }}
                  defaultValue={project.targetDate || ''}
                  onBlur={(e) => updateProject(project._docId, { targetDate: e.target.value })}
                />
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>Tags (comma-separated)</label>
              <input
                style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 6, color: 'var(--color-text-primary)', padding: '6px 10px', fontSize: 13, width: '100%' }}
                defaultValue={(project.tags || []).join(', ')}
                onBlur={(e) => {
                  const tags = e.target.value.split(',').map((t) => t.trim()).filter(Boolean);
                  updateProject(project._docId, { tags });
                }}
                placeholder="xslide, nafplion, operations"
              />
            </div>

            <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                Created: {project.createdAt?.toDate ? project.createdAt.toDate().toLocaleDateString('en-GB') : '—'}
              </span>
            </div>

            <div style={{ marginTop: 24, display: 'flex', gap: 10, paddingTop: 16, borderTop: '1px dashed var(--color-border)' }}>
              <button
                onClick={handleArchive}
                style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 6, color: 'var(--color-text-muted)', fontSize: 13, padding: '6px 14px', cursor: 'pointer' }}
              >
                {project.archived ? 'Unarchive' : 'Archive project'}
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
