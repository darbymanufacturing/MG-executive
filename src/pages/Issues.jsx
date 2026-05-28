import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Flag, ArrowRight, Check, Clock, AlertTriangle, ChevronDown } from 'lucide-react';
import { useIssues } from '../context/IssueContext.jsx';
import EmptyState from '../components/Shared/EmptyState.jsx';
import Skeleton from '../components/Shared/Skeleton.jsx';
import styles from './Issues.module.css';

const TYPE_LABELS = {
  municipality: 'Municipality',
  partnership:  'Partnership',
  facility:     'Facility',
  regulatory:   'Regulatory',
  admin:        'Admin',
  finance:      'Finance',
  other:        'Other',
};

const STATUS_MAP = {
  new:          { label: 'New',         color: 'var(--status-blue)',  bg: 'var(--status-blue-bg)' },
  'in-progress':{ label: 'In progress', color: 'var(--status-amber)', bg: 'var(--status-amber-bg)' },
  waiting:      { label: 'Waiting',     color: 'var(--fg-muted)',     bg: 'var(--bg-hover)' },
  snoozed:      { label: 'Snoozed',     color: 'var(--status-grey)',  bg: 'var(--bg-hover)' },
  done:         { label: 'Done',        color: 'var(--status-green)', bg: 'var(--status-green-bg)' },
};

const URGENCY_COLOR = {
  critical: 'var(--status-red)',
  high:     'var(--status-amber)',
  medium:   'var(--status-blue)',
  low:      'var(--status-grey)',
};

function computeAge(ts) {
  if (!ts) return '';
  const date = ts?.toDate ? ts.toDate() : new Date(ts);
  const hrs = Math.floor((Date.now() - date.getTime()) / 36e5);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

function NewIssueModal({ onClose, onCreate }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('other');
  const [urgency, setUrgency] = useState('medium');
  const [nextAction, setNextAction] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    await onCreate({ title, type, urgency, nextAction });
    onClose();
  };

  return (
    <div className={styles.modalOverlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <Flag size={16} style={{ color: 'var(--accent)' }} />
          <span className={styles.modalTitle}>New Issue</span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className={styles.modalBody}>
          <label className={styles.fieldLabel}>Title *</label>
          <input
            className={styles.input}
            placeholder="What's the issue?"
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoFocus
          />

          <div className={styles.row2}>
            <div>
              <label className={styles.fieldLabel}>Type</label>
              <select className={styles.select} value={type} onChange={e => setType(e.target.value)}>
                {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className={styles.fieldLabel}>Urgency</label>
              <select className={styles.select} value={urgency} onChange={e => setUrgency(e.target.value)}>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          <label className={styles.fieldLabel}>Next action</label>
          <input
            className={styles.input}
            placeholder="The single concrete next step"
            value={nextAction}
            onChange={e => setNextAction(e.target.value)}
          />
        </div>

        <div className={styles.modalFooter}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSave}
            disabled={!title.trim() || saving}
          >
            {saving ? 'Creating…' : 'Create Issue'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Issues() {
  const navigate = useNavigate();
  const { issues, loading, createIssue, resolveIssue, snoozeIssue } = useIssues();
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState('open'); /* open | all | done */

  const filtered = issues.filter(i => {
    if (filter === 'open') return i.status !== 'done';
    if (filter === 'done') return i.status === 'done';
    return true;
  });

  const handleCreate = async (fields) => {
    await createIssue(fields);
  };

  return (
    <div className={styles.page}>
      {/* Page header */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Issues</h1>
          <p className={styles.pageSubtitle}>Track anything that needs attention — municipality, partnerships, admin, facility</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}>
          <Plus size={14} />New Issue
        </button>
      </div>

      {/* Filter tabs */}
      <div className={styles.tabs}>
        {[
          { key: 'open', label: 'Open', count: issues.filter(i => i.status !== 'done').length },
          { key: 'all',  label: 'All',  count: issues.length },
          { key: 'done', label: 'Done', count: issues.filter(i => i.status === 'done').length },
        ].map(tab => (
          <button
            key={tab.key}
            className={`${styles.tab} ${filter === tab.key ? styles.tabActive : ''}`}
            onClick={() => setFilter(tab.key)}
          >
            {tab.label}
            <span className={styles.tabCount}>{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Issues list */}
      <div className={`card ${styles.list}`}>
        {loading && (
          <div style={{ padding: 'var(--space-4)' }}>
            <Skeleton variant="text" lines={3} height="40px" />
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <EmptyState
            icon={Check}
            title={filter === 'open' ? 'No open issues' : 'No issues match this filter'}
            description="All clear — nothing needs attention here."
          />
        )}
        {filtered.map(issue => {
          const s = STATUS_MAP[issue.status] || STATUS_MAP.new;
          const urgColor = URGENCY_COLOR[issue.urgency] || URGENCY_COLOR.medium;
          return (
            <div
              key={issue.id}
              className={styles.issueRow}
              onClick={() => navigate(`/issues/${issue.id}`)}
            >
              <div className={styles.urgencyBar} style={{ background: urgColor }} />
              <div className={styles.issueMain}>
                <div className={styles.issueMeta}>
                  <span className="pill pill-grey" style={{ fontSize: 10 }}>
                    {TYPE_LABELS[issue.type] || 'Other'}
                  </span>
                  <span className={styles.issueAge}>{computeAge(issue.createdAt)}</span>
                </div>
                <div className={styles.issueTitle}>{issue.title || 'Untitled'}</div>
                {issue.nextAction && (
                  <div className={styles.issueNext}>
                    <ArrowRight size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    <span>{issue.nextAction}</span>
                  </div>
                )}
              </div>
              <div className={styles.issueActions} onClick={e => e.stopPropagation()}>
                <span className="pill" style={{ background: s.bg, color: s.color, height: 20, fontSize: 10 }}>
                  {s.label}
                </span>
                {issue.status !== 'done' && (
                  <>
                    <button
                      className="btn btn-ghost btn-xs"
                      title="Snooze"
                      onClick={() => snoozeIssue(issue.id, new Date(Date.now() + 86400_000).toISOString())}
                    >
                      <Clock size={12} />
                    </button>
                    <button
                      className="btn btn-ghost btn-xs"
                      title="Done"
                      onClick={() => resolveIssue(issue.id)}
                    >
                      <Check size={12} />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showNew && (
        <NewIssueModal onClose={() => setShowNew(false)} onCreate={handleCreate} />
      )}
    </div>
  );
}
