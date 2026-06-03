import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles, Paperclip, Camera, Send, Check, Eye, Receipt, RotateCcw,
} from 'lucide-react';
import { useIssues } from '../../context/IssueContext.jsx';
import { useCosts } from '../../context/CostContext.jsx';
import { authedFetch } from '../../utils/apiClient.js';
import styles from './CaptureModal.module.css';

/** Maps diary-parse module kinds to Issue types */
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
    <span className={styles.spinner} style={{ width: size, height: size }} aria-label="Loading" />
  );
}

function KV({ k, v }) {
  if (!v) return null;
  return (
    <div className={styles.kv}>
      <span className={styles.kvKey}>{k}</span>
      <span className={styles.kvVal}>{v}</span>
    </div>
  );
}

/* ─── Mode toggle ─── */
function ModeTab({ label, icon: Icon, active, onClick }) {
  return (
    <button
      className={`${styles.modeTab} ${active ? styles.modeTabActive : ''}`}
      onClick={onClick}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

/* ─── Invoice mode ─── */
function InvoiceCapture({ onClose, addCost }) {
  const [stage, setStage] = useState('pick'); /* pick | parsing | confirm | saving | done | error */
  const [preview, setPreview] = useState(null);   /* data URL */
  const [imageBase64, setImageBase64] = useState(null);
  const [mediaType, setMediaType] = useState('image/jpeg');
  const [invoice, setInvoice] = useState(null);
  const [savingMsg, setSavingMsg] = useState('');
  const fileRef = useRef(null);
  const closeTimerRef = useRef(null);

  /* Cancel auto-close timer on unmount */
  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const type = file.type || 'image/jpeg';
    setMediaType(type);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      setPreview(dataUrl);
      /* Strip the data URI prefix to get pure base64 */
      setImageBase64(dataUrl.split(',')[1]);
    };
    reader.readAsDataURL(file);
  };

  const handleParse = useCallback(async () => {
    if (!imageBase64) return;
    setStage('parsing');
    try {
      const res = await authedFetch('/api/invoice-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mediaType }),
      });
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      setInvoice(data);
      setStage('confirm');
    } catch {
      setStage('error');
    }
  }, [imageBase64, mediaType]);

  const handleSaveCost = async () => {
    setStage('saving');
    setSavingMsg('Saving cost entry…');
    try {
      const costPayload = {
        name: invoice.vendor || 'Invoice',
        amount: invoice.amount || 0,
        category: invoice.suggestedCategory || 'variable',
        frequency: 'once',
        startDate: invoice.date || new Date().toISOString().slice(0, 10),
        notes: `Invoice #${invoice.invoiceNumber || '—'} captured via Omni`,
        source: 'invoice-capture',
      };

      await addCost(costPayload);

      setSavingMsg('Cost saved successfully.');
      setStage('done');
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(onClose, 2500);
    } catch {
      setStage('error');
    }
  };

  return (
    <div className={styles.invoiceWrap}>
      {/* Pick stage */}
      {stage === 'pick' && (
        <>
          <div
            className={styles.dropZone}
            onClick={() => fileRef.current?.click()}
          >
            {preview ? (
              <img src={preview} alt="Invoice preview" className={styles.previewImg} />
            ) : (
              <>
                <Camera size={32} className={styles.dropIcon} />
                <div className={styles.dropText}>Tap to take photo or choose file</div>
                <div className={styles.dropSub}>JPEG, PNG, WebP — invoice or receipt</div>
              </>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={handleFile}
          />
          {preview && (
            <div className={styles.invoiceFooter}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setPreview(null); setImageBase64(null); }}>
                <RotateCcw size={13} />Retake
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleParse}>
                <Sparkles size={13} />Extract invoice data
              </button>
            </div>
          )}
        </>
      )}

      {/* Parsing */}
      {stage === 'parsing' && (
        <div className={styles.parsingBand}>
          <Spinner />
          <span>Claude is reading your invoice… extracting vendor, amount, date, VAT.</span>
        </div>
      )}

      {/* Confirm */}
      {stage === 'confirm' && invoice && (
        <>
          <div className={styles.confirmedBand}>
            <div className={styles.confirmedRow}>
              <Check size={16} className={styles.confirmedCheck} />
              <span className={styles.confirmedTitle}>Invoice extracted</span>
              <span className={`pill pill-${invoice.confidence === 'high' ? 'green' : invoice.confidence === 'medium' ? 'amber' : 'grey'}`} style={{ fontSize: 10 }}>
                {invoice.confidence} confidence
              </span>
            </div>
            <div className={styles.confirmedGrid}>
              <KV k="Vendor"    v={invoice.vendor} />
              <KV k="Amount"    v={invoice.amount ? `€${Number(invoice.amount).toLocaleString('el-GR', { minimumFractionDigits: 2 })}` : null} />
              <KV k="Date"      v={invoice.date} />
              <KV k="VAT"       v={invoice.vatAmount ? `€${Number(invoice.vatAmount).toFixed(2)} (${invoice.vatPercent || 24}%)` : null} />
              <KV k="Inv. №"   v={invoice.invoiceNumber} />
              <KV k="Category" v={invoice.suggestedCategory} />
            </div>
          </div>
          <div className={styles.invoiceFooter}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setStage('pick'); setPreview(null); setImageBase64(null); setInvoice(null); }}>
              <RotateCcw size={13} />Retry
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleSaveCost}>
              <Receipt size={13} />Save as Cost
            </button>
          </div>
        </>
      )}

      {/* Saving */}
      {stage === 'saving' && (
        <div className={styles.parsingBand}>
          <Spinner />
          <span>{savingMsg}</span>
        </div>
      )}

      {/* Done */}
      {stage === 'done' && (
        <div className={styles.confirmedBand}>
          <div className={styles.confirmedRow}>
            <Check size={16} className={styles.confirmedCheck} />
            <span className={styles.confirmedTitle}>{savingMsg}</span>
          </div>
        </div>
      )}

      {/* Error */}
      {stage === 'error' && (
        <div className={styles.errorBand}>
          Could not parse invoice.{' '}
          <button className="btn btn-xs btn-outline" onClick={() => setStage('pick')}>Retry</button>
        </div>
      )}
    </div>
  );
}

/* ─── Main modal ─── */
export default function CaptureModal({ open, onClose }) {
  const { createIssue } = useIssues();
  const { addCost } = useCosts();
  const [mode, setMode] = useState('text');       /* text | invoice */
  const [text, setText] = useState('');
  const [stage, setStage] = useState('idle');     /* idle | typed | parsing | confirmed | error */
  const [result, setResult] = useState(null);
  const [createdId, setCreatedId] = useState(null);
  const textareaRef = useRef(null);
  const overlayRef = useRef(null);
  const closeTimerRef = useRef(null);

  /* Cancel auto-close timer on unmount */
  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);

  /* Reset on open */
  useEffect(() => {
    if (open) {
      setText('');
      setStage('idle');
      setResult(null);
      setCreatedId(null);
      setMode('text');
      setTimeout(() => textareaRef.current?.focus(), 60);
    }
  }, [open]);

  /* Body-scroll lock — mirrors Shared/Modal.jsx #31 pattern */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  /* ESC to close */
  useEffect(() => {
    if (!open) return;
    const handler = e => { if (e.key === 'Escape') onClose(); };
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
      const res = await authedFetch('/api/diary-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      let parsed = null;
      if (res.ok) parsed = await res.json();

      /* Extract the first issue-like action */
      let issueAction = null;
      if (parsed?.actions?.length) {
        issueAction = parsed.actions.find(a => a.module === 'issue' || ACTION_TO_ISSUE_TYPE[a.module]);
      }

      const moduleKey = issueAction?.module;
      const type = moduleKey ? (ACTION_TO_ISSUE_TYPE[moduleKey] || 'other') : 'other';
      const data = issueAction?.data || {};
      const title = data.title || parsed?.summary || text.slice(0, 80).trim();
      const nextAction = data.nextAction || data.suggestedAction || '';
      const urgency = data.urgency || 'medium';

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
        contact: data.contact || data.counterparty || '',
      });
      setStage('confirmed');
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => onClose(), 2500);

    } catch (err) {
      console.error('Capture failed:', err);
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
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        closeTimerRef.current = setTimeout(() => onClose(), 2500);
      } catch {
        setStage('error');
      }
    }
  }, [text, createIssue, onClose]);

  /* ⌘↵ to submit */
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
          <div className={styles.modeTabs}>
            <ModeTab label="Text" icon={Sparkles} active={mode === 'text'} onClick={() => setMode('text')} />
            <ModeTab label="Invoice" icon={Camera} active={mode === 'invoice'} onClick={() => setMode('invoice')} />
          </div>
          <div style={{ flex: 1 }} />
          <span className="kbd">ESC</span>
        </div>

        {/* Text mode */}
        {mode === 'text' && (
          <>
            <div className={styles.body}>
              <textarea
                ref={textareaRef}
                className={styles.textarea}
                placeholder="What needs attention? Phone call, lead, issue, task, meeting…"
                value={text}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                disabled={stage === 'parsing' || stage === 'confirmed'}
                rows={4}
              />
            </div>

            {stage === 'parsing' && (
              <div className={styles.parsingBand}>
                <Spinner />
                <span>Reading your capture… extracting type, contact, urgency.</span>
              </div>
            )}

            {stage === 'confirmed' && result && (
              <div className={styles.confirmedBand}>
                <div className={styles.confirmedRow}>
                  <Check size={16} className={styles.confirmedCheck} />
                  <span className={styles.confirmedTitle}>
                    Created Issue · "{result.title.slice(0, 40)}{result.title.length > 40 ? '…' : ''}"
                  </span>
                  <span className={`pill pill-blue ${styles.typePill}`}>{result.type}</span>
                </div>
                <div className={styles.confirmedGrid}>
                  <KV k="Type"        v={result.type} />
                  <KV k="Urgency"     v={result.urgency} />
                  <KV k="Contact"     v={result.contact} />
                  <KV k="Next action" v={result.nextAction?.slice(0, 40)} />
                </div>
              </div>
            )}

            {stage === 'error' && (
              <div className={styles.errorBand}>
                Failed to save. <button className="btn btn-xs btn-outline" onClick={handleSubmit}>Retry</button>
              </div>
            )}

            <div className={styles.footer}>
              <button className="btn btn-ghost btn-sm"><Paperclip size={14} />Attach</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setMode('invoice')}>
                <Camera size={14} />Invoice
              </button>
              <div style={{ flex: 1 }} />
              {stage === 'confirmed' ? (
                <>
                  <Link to={`/issues/${createdId}`} className="btn btn-outline btn-sm" onClick={onClose}>
                    <Eye size={13} />View Issue
                  </Link>
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
          </>
        )}

        {/* Invoice mode */}
        {mode === 'invoice' && (
          <InvoiceCapture onClose={onClose} addCost={addCost} />
        )}
      </div>
    </div>
  );
}
