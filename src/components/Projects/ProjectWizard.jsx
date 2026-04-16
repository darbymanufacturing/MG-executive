import { useState } from 'react';
import { ChevronRight, ChevronLeft, Plus, X, Check } from 'lucide-react';
import styles from './ProjectWizard.module.css';

const CATEGORIES = ['Expansion', 'Operations', 'Technology', 'Finance', 'Legal', 'Needs Setup'];
const OWNERS     = ['Kostas', 'Panos', 'Both'];

const STATUS_OPTIONS = [
  { value: 'Green', emoji: '🟢', label: 'Green — On Track', desc: 'Making progress, no blockers' },
  { value: 'Amber', emoji: '🟡', label: 'Amber — At Risk',  desc: 'Progress is slow or a risk has emerged' },
  { value: 'Red',   emoji: '🔴', label: 'Red — Blocked',   desc: 'Stuck and needs attention now' },
];

const CATEGORY_DESC = {
  Expansion:   'Opening a new city, growing fleet size, or entering a new market',
  Operations:  'Day-to-day fleet, logistics, staffing, or process improvements',
  Technology:  'Platform migration, app features, integrations, or tools',
  Finance:     'Funding, budgeting, accounting, or financial planning',
  Legal:       'Licenses, contracts, compliance, or regulatory matters',
  'Needs Setup': 'Project captured but not yet scoped — placeholder until details are filled in',
};

const STEPS = [
  { id: 'name',       title: "What's the project?",            hint: "Give it a clear, specific name you'd search for." },
  { id: 'category',   title: 'What type of initiative is it?', hint: 'Pick the category that best fits.' },
  { id: 'owner',      title: 'Who owns it?',                   hint: 'The person responsible for driving it forward.' },
  { id: 'status',     title: 'What\'s the current status?',    hint: 'Be honest — this is for your own clarity.' },
  { id: 'timeline',   title: 'What\'s the timeline?',          hint: 'Rough dates are fine. Leave blank if unknown.' },
  { id: 'description',title: 'Describe it in one sentence.',   hint: 'What are we trying to achieve and why it matters?' },
  { id: 'milestones', title: 'What are the key milestones?',   hint: 'The 2–4 concrete steps that need to happen. You can add more later.' },
  { id: 'blockers',   title: 'Any current blockers?',          hint: 'What is stopping or slowing this project right now?' },
  { id: 'review',     title: 'Ready to create this project?',  hint: 'Review what you\'ve entered.' },
];

const EMPTY = {
  name: '', category: 'Operations', owner: 'Kostas',
  status: 'Green', startDate: '', targetDate: '',
  description: '', milestones: [], blockers: [],
};

export default function ProjectWizard({ open, onClose, onSave }) {
  const [step, setStep]   = useState(0);
  const [form, setForm]   = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  // Milestone / blocker inline inputs
  const [msText,  setMsText]  = useState('');
  const [msDate,  setMsDate]  = useState('');
  const [blkText, setBlkText] = useState('');

  if (!open) return null;

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  function addMilestone() {
    if (!msText.trim()) return;
    set('milestones', [...form.milestones, { id: crypto.randomUUID(), title: msText.trim(), dueDate: msDate, done: false }]);
    setMsText(''); setMsDate('');
  }

  function removeMilestone(id) {
    set('milestones', form.milestones.filter((m) => m.id !== id));
  }

  function addBlocker() {
    if (!blkText.trim()) return;
    set('blockers', [...form.blockers, { id: crypto.randomUUID(), text: blkText.trim(), resolved: false }]);
    setBlkText('');
  }

  function removeBlocker(id) {
    set('blockers', form.blockers.filter((b) => b.id !== id));
  }

  function canNext() {
    if (step === 0) return form.name.trim().length > 0;
    return true;
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && step !== 6 && step !== 7) {
      e.preventDefault();
      if (canNext() && step < STEPS.length - 1) setStep((s) => s + 1);
    }
  }

  async function handleSave() {
    setSaving(true);
    await onSave(form);
    setSaving(false);
    setForm(EMPTY);
    setStep(0);
    onClose();
  }

  function handleClose() {
    setForm(EMPTY);
    setStep(0);
    onClose();
  }

  const current = STEPS[step];
  const progress = ((step) / (STEPS.length - 1)) * 100;

  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className={styles.wizard} onKeyDown={handleKeyDown}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerTop}>
            <span className={styles.stepLabel}>Step {step + 1} of {STEPS.length}</span>
            <button className={styles.closeBtn} onClick={handleClose}><X size={16} /></button>
          </div>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* Body */}
        <div className={styles.body}>
          <h2 className={styles.stepTitle}>{current.title}</h2>
          <p className={styles.stepHint}>{current.hint}</p>

          {/* ── Step content ── */}

          {step === 0 && (
            <div className={styles.fieldWrap}>
              <input
                className={styles.bigInput}
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Nafplion Fleet Expansion"
                autoFocus
              />
            </div>
          )}

          {step === 1 && (
            <div className={styles.cardGrid}>
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  className={`${styles.optionCard} ${form.category === c ? styles.selected : ''}`}
                  onClick={() => set('category', c)}
                >
                  <span className={styles.optionLabel}>{c}</span>
                  <span className={styles.optionDesc}>{CATEGORY_DESC[c]}</span>
                </button>
              ))}
            </div>
          )}

          {step === 2 && (
            <div className={styles.pillRow}>
              {OWNERS.map((o) => (
                <button
                  key={o}
                  className={`${styles.ownerPill} ${form.owner === o ? styles.selected : ''}`}
                  onClick={() => set('owner', o)}
                >
                  {o}
                </button>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className={styles.statusGrid}>
              {STATUS_OPTIONS.map((s) => (
                <button
                  key={s.value}
                  className={`${styles.statusCard} ${form.status === s.value ? styles.selected : ''}`}
                  onClick={() => set('status', s.value)}
                >
                  <span className={styles.statusEmoji}>{s.emoji}</span>
                  <span className={styles.statusLabel}>{s.label}</span>
                  <span className={styles.statusDesc}>{s.desc}</span>
                </button>
              ))}
            </div>
          )}

          {step === 4 && (
            <div className={styles.dateRow}>
              <div className={styles.dateField}>
                <label>Start Date</label>
                <input
                  type="date"
                  className={styles.dateInput}
                  value={form.startDate}
                  onChange={(e) => set('startDate', e.target.value)}
                  autoFocus
                />
              </div>
              <div className={styles.dateField}>
                <label>Target Completion</label>
                <input
                  type="date"
                  className={styles.dateInput}
                  value={form.targetDate}
                  onChange={(e) => set('targetDate', e.target.value)}
                />
              </div>
            </div>
          )}

          {step === 5 && (
            <div className={styles.fieldWrap}>
              <textarea
                className={styles.bigTextarea}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="e.g. Expand the Nafplion fleet from 70 to 100 scooters before peak season to capture additional ride demand."
                rows={4}
                autoFocus
              />
            </div>
          )}

          {step === 6 && (
            <div className={styles.listStep}>
              <ul className={styles.addedList}>
                {form.milestones.map((m) => (
                  <li key={m.id} className={styles.addedItem}>
                    <span className={styles.addedText}>{m.title}</span>
                    {m.dueDate && <span className={styles.addedSub}>{m.dueDate}</span>}
                    <button className={styles.removeBtn} onClick={() => removeMilestone(m.id)}><X size={12} /></button>
                  </li>
                ))}
              </ul>
              <div className={styles.inlineAdd}>
                <input
                  className={styles.inlineInput}
                  value={msText}
                  onChange={(e) => setMsText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMilestone(); }}}
                  placeholder="Add a milestone…"
                  autoFocus
                />
                <input
                  type="date"
                  className={styles.inlineDate}
                  value={msDate}
                  onChange={(e) => setMsDate(e.target.value)}
                />
                <button className={styles.addBtn} onClick={addMilestone}><Plus size={14} /></button>
              </div>
              <p className={styles.skipNote}>Skip if you don't have milestones yet — you can add them later.</p>
            </div>
          )}

          {step === 7 && (
            <div className={styles.listStep}>
              <ul className={styles.addedList}>
                {form.blockers.map((b) => (
                  <li key={b.id} className={`${styles.addedItem} ${styles.blockerItem}`}>
                    <span className={styles.addedText}>{b.text}</span>
                    <button className={styles.removeBtn} onClick={() => removeBlocker(b.id)}><X size={12} /></button>
                  </li>
                ))}
              </ul>
              <div className={styles.inlineAdd}>
                <input
                  className={styles.inlineInput}
                  value={blkText}
                  onChange={(e) => setBlkText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBlocker(); }}}
                  placeholder="e.g. Waiting for city permit approval"
                  autoFocus
                />
                <button className={styles.addBtn} onClick={addBlocker}><Plus size={14} /></button>
              </div>
              <p className={styles.skipNote}>No blockers? Great — just continue.</p>
            </div>
          )}

          {step === 8 && (
            <div className={styles.review}>
              <div className={styles.reviewRow}><span className={styles.reviewKey}>Name</span><span className={styles.reviewVal}>{form.name}</span></div>
              <div className={styles.reviewRow}><span className={styles.reviewKey}>Category</span><span className={styles.reviewVal}>{form.category}</span></div>
              <div className={styles.reviewRow}><span className={styles.reviewKey}>Owner</span><span className={styles.reviewVal}>{form.owner}</span></div>
              <div className={styles.reviewRow}>
                <span className={styles.reviewKey}>Status</span>
                <span className={styles.reviewVal}>
                  {form.status === 'Green' ? '🟢' : form.status === 'Amber' ? '🟡' : '🔴'} {form.status}
                </span>
              </div>
              {(form.startDate || form.targetDate) && (
                <div className={styles.reviewRow}>
                  <span className={styles.reviewKey}>Timeline</span>
                  <span className={styles.reviewVal}>{form.startDate || '—'} → {form.targetDate || '—'}</span>
                </div>
              )}
              {form.description && (
                <div className={styles.reviewRow}><span className={styles.reviewKey}>Description</span><span className={styles.reviewVal}>{form.description}</span></div>
              )}
              {form.milestones.length > 0 && (
                <div className={styles.reviewRow}>
                  <span className={styles.reviewKey}>Milestones</span>
                  <span className={styles.reviewVal}>{form.milestones.length} added</span>
                </div>
              )}
              {form.blockers.length > 0 && (
                <div className={styles.reviewRow}>
                  <span className={styles.reviewKey}>Blockers</span>
                  <span className={`${styles.reviewVal} ${styles.reviewRed}`}>{form.blockers.length} blocker{form.blockers.length > 1 ? 's' : ''}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          {step > 0 ? (
            <button className={styles.backBtn} onClick={() => setStep((s) => s - 1)}>
              <ChevronLeft size={16} /> Back
            </button>
          ) : (
            <button className={styles.backBtn} onClick={handleClose}>Cancel</button>
          )}

          <div className={styles.dots}>
            {STEPS.map((_, i) => (
              <span key={i} className={`${styles.dot} ${i === step ? styles.dotActive : i < step ? styles.dotDone : ''}`} />
            ))}
          </div>

          {step < STEPS.length - 1 ? (
            <button
              className={styles.nextBtn}
              onClick={() => setStep((s) => s + 1)}
              disabled={!canNext()}
            >
              {step === 4 || step === 5 ? (form.targetDate || form.description ? 'Next' : 'Skip') :
               step === 6 || step === 7 ? (form.milestones.length || form.blockers.length ? 'Next' : 'Skip') :
               'Next'} <ChevronRight size={16} />
            </button>
          ) : (
            <button className={styles.createBtn} onClick={handleSave} disabled={saving}>
              {saving ? 'Creating…' : <><Check size={15} /> Create Project</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
