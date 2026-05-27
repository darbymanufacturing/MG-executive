import { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, Paperclip, Camera, Mic, Send, Check, X, Eye, Undo2 } from 'lucide-react';
import { useIssues } from '../../context/IssueContext.jsx';
import styles from './CaptureModal.module.css';

/** Maps diary-parse action kinds to Issue types */
const ACTION_TO_ISSUE_TYPE = {
  municipality: 'municipality',
  partnership:  'partnership',
  facility:     'facility',
  regulatory:   'regulatory',
  admin:        'admin',
  finance:      'finance',
  issue:        'other',
};

function Spinner({ size = 14 }) {
  return (
    <span
      className={styles.spinner}
      style={{ width: size, height: size }}
      aria-label="Loading"
    />
  );
}

function KV({ k, v }) {
  return (
    <div className={styles.kv}>
      <span className={styles.kvKey}>{k}</span>
      <span className={styles.kvVal}>{v}</span>
    </div>
  );
}

export default function CaptureModal({ open, onClose }) {
  const { createIssue } = useIssues();
  const [text, setText] = useState('');
  const [stage, setStage] = useState('idle'); /* idle | typed | parsing | confirmed | error */
  const [result, setResult] = useState(null);
  const [createdId, setCreatedId] = useState(null);
  const textareaRef = useRef(null);
  const overlayRef = useRef(null);

  /* Focus textarea when modal opens */
  useEffect(() => {
    if (open) {
      setText('');
      setStage('idle');
      setResult(null);
      setCreatedId(null);
      setTimeout(() => textareaRef.current?.focus(), 60);
    }
  }, [open]);

  /* ESC to close */
  useEffect(() => {
    const handler = e => {
      if (e.key === 'Escape' && open) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleTextChange = (e) => {
    setText(e.target.value);
    setStage(e.target.value.trim() ? 'typed' : 'idle');
  };

  const handleSubmit = useCallback(async () => {
    if (!text.trim()) return;
    setStage('parsing');

    try {
      /* Call the existing diary-parse endpoint */
      const res = await fetch('/api/diary-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      let parsed = null;
      if (res.ok) {
        parsed = await res.json();
      }

      /* Extract the first issue-like action, or create a generic one */
      let issueAction = null;
      if (parsed?.actions?.length) {
        issueAction = parsed.actions.find(a => a.type === 'issue' || ACTION_TO_ISSUE_TYPE[a.type]);
      }

      /* Build the issue fields */
      const type = issueAction?.type ? (ACTION_TO_ISSUE_TYPE[issueAction.type] || 'other') : 'other';
      const title = issueAction?.title || parsed?.summary || text.slice(0, 80).trim();
      const nextAction = issueAction?.nextAction || issueAction?.suggestedAction || '';
      const urgency = issueAction?.urgency || 'medium';

      /* Create in Firestore */
      const ref = await createIssue({
        title,
        description: text,
        type,
        urgency,
        nextAction,
      });

      setCreatedId(ref.id);
      setResult({
        title,
        type: type.charAt(0).toUpperCase() + type.slice(1),
        urgency: urgency.charAt(0).toUpperCase() + urgency.slice(1),
        nextAction,
        contact: issueAction?.contact || '',
      });
      setStage('confirmed');

      /* Auto-close after 2.5s */
      setTimeout(() => onClose(), 2500);

    } catch (err) {
      console.error('Capture failed:', err);
      /* Even on error, create a basic issue from the text */
      try {
        const ref = await createIssue({
          title: text.slice(0, 80).trim(),
          description: text,
          type: 'other',
          urgency: 'medium',
          nextAction: '',
        });
        setCreatedId(ref.id);
        setResult({ title: text.slice(0, 80).trim(), type: 'Other', urgency: 'Medium', nextAction: '', contact: '' });
        setStage('confirmed');
        setTimeout(() => onClose(), 2500);
      } catch {
        setStage('error');
      }
    }
  }, [text, createIssue, onClose]);

  /* ⌘↵ / Ctrl+↵ to submit */
  const handleKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) onClose();
  };

  if (!open) return null;

  return (
    <div ref={overlayRef} className={styles.overlay} onClick={handleOverlayClick} role="dialog" aria-modal>
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <Sparkles size={18} className={styles.sparkle} />
          <span className={styles.headerTitle}>Capture</span>
          <span className={styles.headerSub}>Type, paste, or drop an image. Claude figures out the rest.</span>
          <div style={{ flex: 1 }} />
          <span className="kbd">ESC</span>
        </div>

        {/* Input */}
        <div className={styles.body}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            placeholder="What needs attention?"
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            disabled={stage === 'parsing' || stage === 'confirmed'}
            rows={4}
          />
        </div>

        {/* Parsing band */}
        {stage === 'parsing' && (
          <div className={styles.parsingBand}>
            <Spinner />
            <span>Reading your capture… extracting type, contact, urgency.</span>
          </div>
        )}

        {/* Confirmed band */}
        {stage === 'confirmed' && result && (
          <div className={styles.confirmedBand}>
            <div className={styles.confirmedRow}>
              <Check size={16} className={styles.confirmedCheck} />
              <span className={styles.confirmedTitle}>Created Issue · "{result.title.slice(0, 40)}{result.title.length > 40 ? '…' : ''}"</span>
              <span className={`pill pill-blue ${styles.typePill}`}>{result.type}</span>
            </div>
            <div className={styles.confirmedGrid}>
              <KV k="Type"           v={result.type} />
              <KV k="Urgency"        v={result.urgency} />
              {result.contact && <KV k="Contact"   v={result.contact} />}
              {result.nextAction && <KV k="Next action" v={result.nextAction.slice(0, 40)} />}
            </div>
          </div>
        )}

        {/* Error band */}
        {stage === 'error' && (
          <div className={styles.errorBand}>
            Failed to save. <button className="btn btn-xs btn-outline" onClick={handleSubmit}>Retry</button>
          </div>
        )}

        {/* Footer */}
        <div className={styles.footer}>
          <button className="btn btn-ghost btn-sm"><Paperclip size={14} />Attach</button>
          <button className="btn btn-ghost btn-sm"><Camera size={14} />Photo</button>
          <button className="btn btn-ghost btn-sm"><Mic size={14} />Voice</button>
          <div style={{ flex: 1 }} />
          {stage === 'confirmed' ? (
            <>
              <a href={`/issues/${createdId}`} className="btn btn-outline btn-sm" onClick={onClose}>
                <Eye size={13} />View Issue
              </a>
              <button className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
            </>
          ) : (
            <>
              <span className={styles.footerHint}>Claude parses on submit</span>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSubmit}
                disabled={!text.trim() || stage === 'parsing'}
              >
                <Send size={13} />
                Capture
                <span className="kbd" style={{ background: 'rgba(255,255,255,.18)', color: '#fff', borderColor: 'transparent' }}>⏎</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
