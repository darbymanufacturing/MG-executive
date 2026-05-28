import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Sparkles, Calendar, Folder, Lock,
  Paperclip, Plus, Send, Check, Flag,
} from 'lucide-react';
import { useIssue, useIssues } from '../context/IssueContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import styles from './IssueDetail.module.css';

const TYPE_LABELS = {
  municipality: 'Municipality', partnership: 'Partnership', facility: 'Facility',
  regulatory: 'Regulatory',    admin: 'Admin',              finance: 'Finance', other: 'Other',
};
const STATUS_MAP = {
  new:          { label: 'New',         color: 'var(--status-blue)',  bg: 'var(--status-blue-bg)' },
  'in-progress':{ label: 'In progress', color: 'var(--status-amber)', bg: 'var(--status-amber-bg)' },
  waiting:      { label: 'Waiting',     color: 'var(--fg-muted)',     bg: 'var(--bg-hover)' },
  snoozed:      { label: 'Snoozed',     color: 'var(--status-grey)',  bg: 'var(--bg-hover)' },
  done:         { label: 'Done',        color: 'var(--status-green)', bg: 'var(--status-green-bg)' },
};
const URGENCY_PILL = {
  critical: { label: 'Critical', cls: 'pill-red' },
  high:     { label: 'High',     cls: 'pill-amber' },
  medium:   { label: 'Medium',   cls: 'pill-blue' },
  low:      { label: 'Low',      cls: 'pill-grey' },
};

function humanAge(ts) {
  if (!ts) return '';
  const date = ts?.toDate ? ts.toDate() : new Date(ts);
  const hrs = Math.floor((Date.now() - date.getTime()) / 36e5);
  if (hrs < 1) return 'just now';
  if (hrs < 24) return `${hrs}h old`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? '1 day old' : `${days} days old`;
}

export default function IssueDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const issue = useIssue(id);
  const { updateIssue, resolveIssue, addNote } = useIssues();
  const { user } = useAuth();

  const [newNote, setNewNote] = useState('');
  const [noteError, setNoteError] = useState(null);
  const [editingNextAction, setEditingNextAction] = useState(false);
  const [nextActionVal, setNextActionVal] = useState('');

  if (!issue) {
    return (
      <div className={styles.page}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/issues')}>
          <ArrowLeft size={14} />Back to Issues
        </button>
        <div className={styles.notFound}>Issue not found.</div>
      </div>
    );
  }

  const s = STATUS_MAP[issue.status] || STATUS_MAP.new;
  const u = URGENCY_PILL[issue.urgency] || URGENCY_PILL.medium;
  const age = humanAge(issue.createdAt);

  // #149 + #189: wrap in try/catch; only clear input on success
  const handleSendNote = async () => {
    if (!newNote.trim()) return;
    setNoteError(null);
    try {
      await addNote(id, newNote.trim());
      setNewNote(''); // only clear on success
    } catch (err) {
      // Do NOT clear newNote — let user retry
      setNoteError(err.message || 'Failed to send note. Please try again.');
    }
  };

  const handleStatusChange = (status) => {
    updateIssue(id, { status });
  };

  const handleSaveNextAction = async () => {
    await updateIssue(id, { nextAction: nextActionVal });
    setEditingNextAction(false);
  };

  return (
    <div className={styles.page}>
      {/* Back */}
      <button className={`btn btn-ghost btn-sm ${styles.back}`} onClick={() => navigate('/issues')}>
        <ArrowLeft size={14} />Issues
      </button>

      <div className={styles.layout}>
        {/* Main pane */}
        <div className={styles.main}>
          {/* Header card */}
          <div className={`card ${styles.card}`}>
            <div className={styles.pillRow}>
              <span className={`pill ${u.cls}`}>{u.label}</span>
              <span className="pill pill-blue">{TYPE_LABELS[issue.type] || 'Other'}</span>
              <span className={styles.ageText}>· {age}</span>
            </div>
            <h1 className={styles.issueTitle}>{issue.title || 'Untitled'}</h1>
            <div className={styles.metaRow}>
              {/* Status pill (clickable) */}
              <span
                className="pill"
                style={{ background: s.bg, color: s.color }}
              >
                {s.label}
              </span>
              {issue.dueDate && (
                <span className={styles.metaItem}>
                  <Calendar size={13} /> Due {new Date(issue.dueDate).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>

          {/* Next action card */}
          <div className={`card ${styles.card} ${styles.nextActionCard}`}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Next action</div>
            {editingNextAction ? (
              <div className={styles.nextActionEdit}>
                <input
                  className={styles.nextActionInput}
                  value={nextActionVal}
                  onChange={e => setNextActionVal(e.target.value)}
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveNextAction(); if (e.key === 'Escape') setEditingNextAction(false); }}
                />
                <button className="btn btn-primary btn-sm" onClick={handleSaveNextAction}>Save</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditingNextAction(false)}>Cancel</button>
              </div>
            ) : (
              <div
                className={styles.nextActionText}
                onClick={() => { setNextActionVal(issue.nextAction || ''); setEditingNextAction(true); }}
              >
                <ArrowRight size={20} className={styles.nextArrow} />
                <span>{issue.nextAction || 'Click to add next action…'}</span>
              </div>
            )}
            <div className={styles.actionBtns}>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => resolveIssue(id)}
                disabled={issue.status === 'done'}
              >
                <Check size={13} />Mark done
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { setNextActionVal(issue.nextAction || ''); setEditingNextAction(true); }}
              >
                <Sparkles size={13} />Edit
              </button>
            </div>
          </div>

          {/* Description */}
          {issue.description && (
            <div className={`card ${styles.card}`}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Description</div>
              <p className={styles.description}>{issue.description}</p>
            </div>
          )}

          {/* Attachments */}
          <div className={`card ${styles.card}`}>
            <div className={styles.sectionHeader}>
              <div className="eyebrow">Attachments{issue.attachments?.length ? ` · ${issue.attachments.length}` : ''}</div>
              <button className="btn btn-ghost btn-sm"><Plus size={13} />Add</button>
            </div>
            <div className={styles.attachGrid}>
              {(issue.attachments || []).map((a, i) => (
                <div key={i} className={styles.attachTile}>
                  <Paperclip size={16} style={{ color: 'var(--accent)' }} />
                  <span>{a.url?.split('/').pop() || `Attachment ${i + 1}`}</span>
                </div>
              ))}
              <div className={`${styles.attachTile} ${styles.attachAdd}`}>
                <Plus size={18} />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className={`card ${styles.card}`}>
            <div className="eyebrow" style={{ marginBottom: 14 }}>Notes</div>
            {(issue.notes || []).map((n, i) => (
              <div key={i} className={styles.note}>
                <div className={styles.noteAvatar}>
                  {(n.authorUid?.slice(0, 2) || 'U').toUpperCase()}
                </div>
                <div className={styles.noteBody}>
                  <div className={styles.noteMeta}>
                    <span className={styles.noteAuthor}>
                      {n.authorUid === user?.uid ? 'You' : 'Team member'}
                    </span>
                    <span className={styles.noteTime}>{new Date(n.at).toLocaleString()}</span>
                  </div>
                  <div className={styles.noteText}>{n.text}</div>
                </div>
              </div>
            ))}
            {!issue.notes?.length && (
              <div className={styles.noNotes}>No notes yet. Add the first one.</div>
            )}
            {noteError && (
              <div style={{ color: 'var(--status-red)', fontSize: 13, marginBottom: 8 }}>
                {noteError}
              </div>
            )}
            <div className={styles.noteComposer}>
              <input
                className={styles.noteInput}
                placeholder="Add a note…"
                value={newNote}
                onChange={e => { setNewNote(e.target.value); setNoteError(null); }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendNote(); } }}
              />
              <button className="btn btn-primary btn-sm" onClick={handleSendNote} disabled={!newNote.trim()}>
                <Send size={13} />Send
              </button>
            </div>
          </div>
        </div>

        {/* Right rail */}
        <div className={styles.rail}>
          <div className={`card ${styles.card}`}>
            <div className="eyebrow" style={{ marginBottom: 12 }}>Visibility</div>
            <div className={styles.visibilityRow}>
              <Lock size={13} style={{ color: 'var(--accent)' }} />
              <span className={styles.visLabel}>
                {issue.visibility === 'admin' ? 'Founders & ops manager' : issue.visibility || 'Admin only'}
              </span>
            </div>
            <div className={styles.visNote}>Crew won't see this issue.</div>
          </div>

          {issue.relatedEntity && (
            <div className={`card ${styles.card}`}>
              <div className="eyebrow" style={{ marginBottom: 12 }}>Linked</div>
              <div className={styles.linkRow}>
                <Folder size={14} style={{ color: 'var(--accent)' }} />
                <div>
                  <div className={styles.linkLabel}>{issue.relatedEntity.kind} #{issue.relatedEntity.id}</div>
                </div>
              </div>
            </div>
          )}

          <div className={`card ${styles.card}`}>
            <div className="eyebrow" style={{ marginBottom: 12 }}>Status</div>
            <div className={styles.statusButtons}>
              {Object.entries(STATUS_MAP).map(([key, val]) => (
                <button
                  key={key}
                  className={`btn btn-outline btn-xs ${issue.status === key ? styles.statusActive : ''}`}
                  style={issue.status === key ? { background: val.bg, borderColor: val.color, color: val.color } : {}}
                  onClick={() => handleStatusChange(key)}
                >
                  {val.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
