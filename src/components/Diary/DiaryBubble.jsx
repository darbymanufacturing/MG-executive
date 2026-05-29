import { useState, useRef, useEffect } from 'react';
import { PenLine, X, Download, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { useDiary } from '../../context/DiaryContext.jsx';
import { useCosts } from '../../context/CostContext.jsx';
import { useMaintenance } from '../../context/MaintenanceContext.jsx';
import { useProjects } from '../../context/ProjectContext.jsx';
import { exportDiaryCSV } from '../../utils/diaryExport.js';
import { authedFetch } from '../../utils/apiClient.js';
import DiaryEntry from './DiaryEntry.jsx';
import styles from './DiaryBubble.module.css';

const MODULE_LABELS = {
  cost: 'Cost', revenue: 'Revenue', scooter: 'Scooter',
  ticket: 'Ticket', part: 'Part', project: 'Project',
  milestone: 'Milestone', blocker: 'Blocker', update: 'Update', gate: 'Gate',
};

export default function DiaryBubble() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('input');   // 'input' | 'preview' | 'history'
  const [text, setText] = useState('');
  const [parsedResult, setParsedResult] = useState(null); // { summary, actions, unresolved }
  const [pendingDocId, setPendingDocId] = useState(null);
  const [editingEntry, setEditingEntry] = useState(null); // entry being edited
  const [phase, setPhase] = useState('idle');  // 'idle' | 'parsing' | 'applying' | 'done' | 'error'
  const [errorMsg, setErrorMsg] = useState('');
  const textareaRef = useRef(null);
  const abortController = useRef(new AbortController());

  const { entries, saveDraftEntry, applyEntry, rejectEntry, editEntry } = useDiary();

  // Abort in-flight parse requests when panel is unmounted
  useEffect(() => {
    return () => { abortController.current.abort(); };
  }, []);
  const { config } = useCosts();
  const { scooters } = useMaintenance();
  const { activeProjects } = useProjects();

  function buildContext() {
    return {
      today: new Date().toISOString().slice(0, 10),
      locations: config?.locations || [],
      scooterIds: (scooters || []).map((s) => s.scooterId).filter(Boolean),
      projectNames: (activeProjects || []).map((p) => p.name).filter(Boolean),
    };
  }

  async function handleParse() {
    const trimmed = text.trim();
    if (!trimmed) return;
    abortController.current.abort();
    abortController.current = new AbortController();
    setPhase('parsing');
    setErrorMsg('');
    try {
      const res = await authedFetch('/api/diary-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed, context: buildContext() }),
        signal: abortController.current.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${res.status}`);
      }
      const data = await res.json();
      setParsedResult(data);
      // Save as pending draft
      const docId = await saveDraftEntry({
        rawText: trimmed,
        summary: data.summary,
        actions: data.actions,
        unresolved: data.unresolved,
      });
      setPendingDocId(docId);
      setView('preview');
      setPhase('idle');
    } catch (err) {
      setPhase('error');
      setErrorMsg(err.message);
    }
  }

  async function handleApply() {
    if (!pendingDocId) return;
    setPhase('applying');
    try {
      await applyEntry(pendingDocId);
      setPhase('done');
      setTimeout(() => {
        setText('');
        setParsedResult(null);
        setPendingDocId(null);
        setView('history');
        setPhase('idle');
      }, 1200);
    } catch (err) {
      setPhase('error');
      setErrorMsg(err.message);
    }
  }

  async function handleDiscard() {
    if (pendingDocId) await rejectEntry(pendingDocId);
    setText('');
    setParsedResult(null);
    setPendingDocId(null);
    setView('input');
    setPhase('idle');
  }

  async function handleEditApply(entry, newText) {
    setPhase('parsing');
    setErrorMsg('');
    try {
      const res = await authedFetch('/api/diary-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newText.trim(), context: buildContext() }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      await editEntry(entry._docId, {
        rawText: newText.trim(),
        summary: data.summary,
        actions: data.actions,
        unresolved: data.unresolved,
      });
      setPendingDocId(entry._docId);
      setParsedResult(data);
      setView('preview');
      setPhase('idle');
      setEditingEntry(null);
    } catch (err) {
      setPhase('error');
      setErrorMsg(err.message);
    }
  }

  function startEdit(entry) {
    setEditingEntry(entry);
    setText(entry.rawText);
    setView('input');
  }

  const hasPendingWarnings = entries.some((e) => e.status === 'partial' || e.unresolved?.length > 0);

  return (
    <>
      {/* ── Collapsed bubble ── */}
      {!open && (
        <button
          className={`${styles.bubble} ${hasPendingWarnings ? styles.bubbleWarning : ''}`}
          onClick={() => setOpen(true)}
          aria-label="Open diary"
        >
          <PenLine size={20} />
          {hasPendingWarnings && <span className={styles.warningDot} />}
        </button>
      )}

      {/* ── Expanded panel ── */}
      {open && (
        <div className={styles.panel}>
          {/* Header */}
          <div className={styles.panelHeader}>
            <PenLine size={14} />
            <span className={styles.panelTitle}>Omni Diary</span>
            <div className={styles.tabBar}>
              <button
                className={`${styles.tabBtn} ${view === 'input' ? styles.tabActive : ''}`}
                onClick={() => setView('input')}
              >Log</button>
              <button
                className={`${styles.tabBtn} ${view === 'history' ? styles.tabActive : ''}`}
                onClick={() => setView('history')}
              >
                History
                {entries.length > 0 && <span className={styles.countBadge}>{entries.length}</span>}
              </button>
            </div>
            <button className={styles.closeBtn} onClick={() => { abortController.current.abort(); abortController.current = new AbortController(); setOpen(false); }} aria-label="Close">
              <X size={14} />
            </button>
          </div>

          {/* ── INPUT VIEW ── */}
          {view === 'input' && (
            <div className={styles.inputView}>
              <textarea
                ref={textareaRef}
                className={styles.textarea}
                placeholder={
                  editingEntry
                    ? `Editing: ${editingEntry.summary}`
                    : "What happened today? e.g. \"Added scooter NG-045 to Nafplion\" or \"Nafplion revenue yesterday was €340, 22 trips\""
                }
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    if (editingEntry) handleEditApply(editingEntry, text);
                    else handleParse();
                  }
                }}
                rows={5}
                disabled={phase === 'parsing'}
              />
              {phase === 'error' && (
                <div className={styles.errorBanner}>
                  <AlertTriangle size={12} /> {errorMsg}
                </div>
              )}
              <div className={styles.inputFooter}>
                {editingEntry && (
                  <button className={styles.cancelEditBtn} onClick={() => { setEditingEntry(null); setText(''); }}>
                    Cancel edit
                  </button>
                )}
                <button
                  className={styles.logBtn}
                  onClick={() => editingEntry ? handleEditApply(editingEntry, text) : handleParse()}
                  disabled={!text.trim() || phase === 'parsing'}
                >
                  {phase === 'parsing' ? (
                    <><Loader2 size={13} className={styles.spin} /> Parsing…</>
                  ) : (
                    <><PenLine size={13} /> {editingEntry ? 'Re-parse & Preview' : 'Preview Actions'}</>
                  )}
                </button>
              </div>
              <p className={styles.hint}>Tip: Ctrl+Enter to submit</p>
            </div>
          )}

          {/* ── PREVIEW VIEW ── */}
          {view === 'preview' && parsedResult && (
            <div className={styles.previewView}>
              <div className={styles.previewSummary}>{parsedResult.summary}</div>

              {/* Action count label */}
              {parsedResult.actions.length > 0 && (
                <div className={styles.actionCountLabel}>
                  {parsedResult.actions.length} {parsedResult.actions.length === 1 ? 'Pending Action' : 'Pending Actions'}
                </div>
              )}

              {/* Action chips */}
              <div className={styles.actionChips}>
                {parsedResult.actions.map((a, i) => (
                  <div key={i} className={styles.actionChip}>
                    <span className={`${styles.opTag} ${styles[`op_${a.operation}`]}`}>{a.operation}</span>
                    <span className={styles.chipModule}>{MODULE_LABELS[a.module] || a.module}</span>
                    <span className={styles.chipData}>
                      {a.data?.name || a.data?.scooterId || a.data?.title || a.data?.text ||
                       a.data?.location || a.data?.projectName || ''}
                    </span>
                  </div>
                ))}
                {parsedResult.actions.length === 0 && (
                  <p className={styles.noActions}>No structured actions detected.</p>
                )}
              </div>

              {/* Warnings */}
              {parsedResult.unresolved?.length > 0 && (
                <div className={styles.warnings}>
                  {parsedResult.unresolved.map((u, i) => (
                    <div key={i} className={styles.warningRow}>
                      <AlertTriangle size={11} /> {u}
                    </div>
                  ))}
                </div>
              )}

              {phase === 'done' && (
                <div className={styles.successBanner}>
                  <CheckCircle size={13} /> Applied successfully!
                </div>
              )}
              {phase === 'error' && (
                <div className={styles.errorBanner}>
                  <AlertTriangle size={12} /> {errorMsg}
                </div>
              )}

              <div className={styles.previewFooter}>
                <button className={styles.discardBtn} onClick={handleDiscard} disabled={phase === 'applying'}>
                  Discard
                </button>
                <button
                  className={styles.applyBtn}
                  onClick={handleApply}
                  disabled={phase === 'applying' || phase === 'done' || parsedResult.actions.length === 0}
                >
                  {phase === 'applying' ? (
                    <><Loader2 size={13} className={styles.spin} /> Applying…</>
                  ) : 'Apply to App'}
                </button>
              </div>
            </div>
          )}

          {/* ── HISTORY VIEW ── */}
          {view === 'history' && (
            <div className={styles.historyView}>
              {entries.length === 0 ? (
                <p className={styles.emptyHistory}>No diary entries yet.</p>
              ) : (
                <div className={styles.entryList}>
                  {entries.map((e) => (
                    <DiaryEntry key={e._docId} entry={e} onEdit={startEdit} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          <div className={styles.panelFooter}>
            <button className={styles.exportBtn} onClick={() => exportDiaryCSV(entries)} disabled={entries.length === 0}>
              <Download size={12} /> Export CSV
            </button>
          </div>
        </div>
      )}
    </>
  );
}
