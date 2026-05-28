import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useProjects } from '../../context/ProjectContext.jsx';
import { isPowDay, weekOfLabel, currentWeekStart, powStaleness } from '../../utils/powHelpers.js';
import { STATUS_CONFIG, OWNERS } from './constants.js';
import styles from './PowHistory.module.css';
import sharedStyles from './Projects.module.css';

export default function PowHistory({ project }) {
  const { addPowEntry } = useProjects();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    moved: '',
    blocked: '',
    focusNext: '',
    status: project.effectiveStatus || 'onTrack',
    loggedBy: 'Kostas',
  });
  const [saving, setSaving] = useState(false);

  const entries = project.powEntries || [];
  const powDay = isPowDay();
  const staleness = powStaleness(entries[0]?.loggedAt || null);

  // Detect if a POW entry already logged this week
  const weekStart = currentWeekStart();
  // Normalize weekOf before comparing — handles Firestore Timestamps (#269)
  const alreadyLoggedThisWeek = entries.some((e) => {
    const storedWeekOf = e.weekOf?.toDate ? e.weekOf.toDate().toISOString().slice(0, 10) : String(e.weekOf || '');
    return storedWeekOf === weekStart;
  });

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.moved.trim()) return;
    setSaving(true);
    try {
      await addPowEntry(project._docId, { ...form, weekOf: weekStart });
      setForm({ moved: '', blocked: '', focusNext: '', status: project.effectiveStatus || 'onTrack', loggedBy: 'Kostas' });
      setShowForm(false);
    } catch (err) {
      console.error('Failed to save POW entry:', err);
    }
    setSaving(false);
  }

  // Detect consecutive blocked entries (3+)
  const consecutiveBlocked = (() => {
    let count = 0;
    for (const e of entries) {
      if (e.status === 'blocked') count++;
      else break;
    }
    return count;
  })();

  return (
    <div className={styles.container}>
      {consecutiveBlocked >= 3 && (
        <div className={styles.warningBanner}>
          ⚠ Blocked {consecutiveBlocked} weeks running — this is a strategy problem, not a task problem.
        </div>
      )}

      {staleness === 'red' && entries.length > 0 && (
        <div className={styles.staleBanner}>
          Last POW logged {Math.round((Date.now() - new Date(entries[0].loggedAt)) / 86400000)} days ago — log an entry.
        </div>
      )}

      {powDay && !alreadyLoggedThisWeek && (
        <div className={styles.powPrompt}>
          📋 Today is POW day — log this week&apos;s entry below.
        </div>
      )}

      {/* Log button / form */}
      {!alreadyLoggedThisWeek && (
        showForm ? (
          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.weekLabel}>{weekOfLabel()}</div>

            <div>
              <label className={styles.fieldLabel}>What moved this week? *</label>
              <textarea
                className={sharedStyles.input}
                rows={2}
                placeholder="What actually progressed…"
                value={form.moved}
                onChange={(e) => setForm((f) => ({ ...f, moved: e.target.value }))}
                required
                autoFocus
                style={{ resize: 'vertical' }}
              />
            </div>
            <div>
              <label className={styles.fieldLabel}>What&apos;s blocked?</label>
              <textarea
                className={sharedStyles.input}
                rows={2}
                placeholder="Current blockers or friction…"
                value={form.blocked}
                onChange={(e) => setForm((f) => ({ ...f, blocked: e.target.value }))}
                style={{ resize: 'vertical' }}
              />
            </div>
            <div>
              <label className={styles.fieldLabel}>Focus for next week</label>
              <input
                className={sharedStyles.input}
                placeholder="One clear priority for next week…"
                value={form.focusNext}
                onChange={(e) => setForm((f) => ({ ...f, focusNext: e.target.value }))}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className={styles.fieldLabel}>Status at POW</label>
                <select
                  className={sharedStyles.select}
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                >
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>{v.dot} {v.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={styles.fieldLabel}>Logged by</label>
                <select
                  className={sharedStyles.select}
                  value={form.loggedBy}
                  onChange={(e) => setForm((f) => ({ ...f, loggedBy: e.target.value }))}
                >
                  {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className={sharedStyles.btnGhost} onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className={sharedStyles.btnPrimary} disabled={saving}>
                {saving ? 'Saving…' : 'Log POW Entry'}
              </button>
            </div>
          </form>
        ) : (
          <button className={styles.addBtn} onClick={() => setShowForm(true)}>
            <Plus size={14} /> Log POW Entry — {weekOfLabel()}
          </button>
        )
      )}

      {alreadyLoggedThisWeek && (
        <div className={styles.loggedBadge}>✓ POW logged this week</div>
      )}

      {/* History */}
      {entries.length > 0 && (
        <ul className={styles.list}>
          {entries.map((e) => {
            const statusCfg = STATUS_CONFIG[e.status] || STATUS_CONFIG.onTrack;
            return (
              <li key={e.id} className={styles.entry}>
                <div className={styles.entryHeader}>
                  <span className={styles.weekOf}>{weekOfLabel(e.weekOf)}</span>
                  <span className={styles.entryStatus} style={{ color: statusCfg.color }}>
                    {statusCfg.dot} {statusCfg.label}
                  </span>
                  {e.loggedBy && <span className={styles.loggedBy}>{e.loggedBy}</span>}
                </div>
                {e.moved && (
                  <div className={styles.field}>
                    <span className={styles.fieldKey}>What moved:</span>
                    <span className={styles.fieldVal}>{e.moved}</span>
                  </div>
                )}
                {e.blocked && (
                  <div className={styles.field}>
                    <span className={styles.fieldKey}>What&apos;s blocked:</span>
                    <span className={styles.fieldVal}>{e.blocked}</span>
                  </div>
                )}
                {e.focusNext && (
                  <div className={styles.field}>
                    <span className={styles.fieldKey}>Focus next week:</span>
                    <span className={styles.fieldVal}>{e.focusNext}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {entries.length === 0 && !showForm && (
        <p className={sharedStyles.empty}>No POW entries yet for this project.</p>
      )}
    </div>
  );
}
