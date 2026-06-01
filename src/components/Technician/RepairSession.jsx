import { useState, useMemo, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ChevronRight, CheckCircle2, Plus, Minus,
  Clock, Search, X, Loader2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useMaintenance } from '../../context/MaintenanceContext.jsx';
import { useRepairProcedures } from '../../context/RepairProcedureContext.jsx';
import PhotoUpload from './PhotoUpload.jsx';
import { completeRepairSession } from '../../utils/repairSessionWriter.js';
import { computeRepairPay } from '../../utils/repairPayCalc.js';
import styles from './RepairSession.module.css';

const FALLBACK_PROCEDURE = {
  id: null,
  title: 'General Repair',
  steps: [{ stepNumber: 1, instruction: 'Complete the repair and log all parts used.', notes: '', requiresPhoto: false }],
  commonParts: [],
};

function sessionIdFor(ticketId) {
  return `${ticketId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function elapsed(startedAt) {
  const ms  = Date.now() - startedAt.getTime();
  const min = Math.floor(ms / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}m`;
}

// ── Inline searchable part picker ─────────────────────────────────────────────
function PartPicker({ parts, onAdd }) {
  const [query, setQuery] = useState('');
  const [open,  setOpen]  = useState(false);

  const filtered = useMemo(() =>
    query.trim()
      ? parts.filter((p) =>
          p.partName.toLowerCase().includes(query.toLowerCase()) ||
          p.sku?.toLowerCase().includes(query.toLowerCase())
        ).slice(0, 8)
      : parts.slice(0, 8),
  [parts, query]);

  return (
    <div className={styles.partPickerWrap}>
      <div className={styles.partPickerRow}>
        <Search size={14} className={styles.partPickerIcon} />
        <input
          className={styles.partPickerInput}
          placeholder="Add part…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      </div>
      {open && filtered.length > 0 && (
        <ul className={styles.partDropdown}>
          {filtered.map((p) => {
            const stock = p.stockOnHand ?? 0;
            const outOfStock = stock <= 0;
            return (
              <li
                key={p._docId}
                className={outOfStock
                  ? `${styles.partDropdownItem} ${styles.partDropdownItemOutOfStock}`
                  : styles.partDropdownItem
                }
                aria-disabled={outOfStock || undefined}
                onMouseDown={() => {
                  // #421 — block adding zero-stock parts at pick time
                  if (outOfStock) return;
                  onAdd({ partId: p._docId, partName: p.partName, quantity: 1, unitCost: p.unitCost ?? 0 });
                  setQuery('');
                  setOpen(false);
                }}
              >
                <span>{p.partName}</span>
                {outOfStock
                  ? <span className={styles.partStockLabelOos}>(out of stock)</span>
                  : <span className={styles.partStockLabel}>{p.sku} · {stock} left</span>
                }
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Parts list for a step ─────────────────────────────────────────────────────
function StepPartsEditor({ partsUsed, onUpdate, allParts }) {
  // #421 — look up stockOnHand for a given partId from the master parts list
  function stockFor(partId) {
    const src = allParts.find((ap) => ap._docId === partId);
    return src?.stockOnHand ?? Infinity; // Infinity = no stock data → uncapped
  }

  function setQty(idx, delta) {
    const next = partsUsed.map((p, i) => {
      if (i !== idx) return p;
      // #421 — cap quantity at available stock on the + path
      const maxStock = stockFor(p.partId);
      return { ...p, quantity: Math.min(Math.max(1, p.quantity + delta), maxStock) };
    });
    onUpdate(next);
  }

  function remove(idx) {
    onUpdate(partsUsed.filter((_, i) => i !== idx));
  }

  function addPart(part) {
    const exists = partsUsed.findIndex((p) => p.partId === part.partId);
    if (exists >= 0) {
      setQty(exists, 1);
    } else {
      // #421 — defence-in-depth: cap initial quantity at available stock (handles
      // commonParts pre-loaded from a procedure whose stock dropped to zero between
      // page load and the pick, or a race condition where PartPicker's guard was bypassed).
      const maxStock = stockFor(part.partId);
      if (maxStock <= 0) return; // already blocked in PartPicker; skip silently
      onUpdate([...partsUsed, { ...part, quantity: Math.min(1, maxStock) }]);
    }
  }

  return (
    <div className={styles.partsEditor}>
      <p className={styles.partsLabel}>Parts used this step</p>
      {partsUsed.length > 0 && (
        <div className={styles.partRows}>
          {partsUsed.map((p, idx) => {
            const maxStock = stockFor(p.partId);
            return (
              <div key={idx} className={styles.partRow}>
                <span className={styles.partName}>
                  {p.partName}
                  {/* #421 — show current stock so technician knows the upper limit */}
                  {maxStock !== Infinity && (
                    <span className={styles.partStockLabel}> ({maxStock} left)</span>
                  )}
                </span>
                <div className={styles.qtyControl}>
                  <button className={styles.qtyBtn} onClick={() => setQty(idx, -1)}><Minus size={12} /></button>
                  <span className={styles.qtyVal}>{p.quantity}</span>
                  <button
                    className={styles.qtyBtn}
                    onClick={() => setQty(idx, 1)}
                    disabled={p.quantity >= maxStock}
                  >
                    <Plus size={12} />
                  </button>
                </div>
                <button className={styles.removePartBtn} onClick={() => remove(idx)}><X size={13} /></button>
              </div>
            );
          })}
        </div>
      )}
      <PartPicker parts={allParts} onAdd={addPart} />
    </div>
  );
}

// ── Summary screen ────────────────────────────────────────────────────────────
function SummaryScreen({
  procedure, stepData, startedAt, onComplete, completing, completeErr,
  labourRatePerHour, extraMinutes, extraWorkNote, onExtraMinutes, onExtraWorkNote,
}) {
  const allParts = {};
  stepData.forEach((s) => {
    (s.partsUsed ?? []).forEach(({ partId, partName, quantity, unitCost }) => {
      if (!allParts[partId]) allParts[partId] = { partName, quantity: 0, unitCost: unitCost ?? 0 };
      allParts[partId].quantity += quantity;
    });
  });
  const aggregated = Object.values(allParts);

  // Phase 2.5 F1 — pay breakdown previewed with the SAME pure fn the writer persists.
  const estimatedMinutes = procedure?.estimatedMinutes ?? 0;
  const pay = computeRepairPay({
    estimatedMinutes,
    labourRatePerHour,
    extraMinutes,
    partsUsed: aggregated,
  });

  return (
    <div className={styles.summary}>
      <div className={styles.summaryHeader}>
        <CheckCircle2 size={40} className={styles.summaryIcon} />
        <h2 className={styles.summaryTitle}>Repair complete!</h2>
        <p className={styles.summaryTime}>
          <Clock size={14} /> {elapsed(startedAt)} elapsed
        </p>
      </div>

      <div className={styles.summaryCard}>
        <p className={styles.summarySection}>Parts used</p>
        {aggregated.length === 0 ? (
          <p className={styles.summaryNone}>No parts logged</p>
        ) : (
          aggregated.map((p, i) => (
            <div key={i} className={styles.summaryPartRow}>
              <span>{p.partName}</span>
              <span className={styles.summaryPartQty}>×{p.quantity}</span>
              <span className={styles.summaryPartCost}>€{(p.quantity * p.unitCost).toFixed(2)}</span>
            </div>
          ))
        )}
      </div>

      {/* Phase 2.5 F1 — extra-work entry (optional) */}
      <div className={styles.summaryCard}>
        <p className={styles.summarySection}>Extra work (optional)</p>
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Extra minutes beyond the estimate</label>
          <input
            type="number"
            min="0"
            inputMode="numeric"
            className={styles.notesInput}
            placeholder="0"
            value={extraMinutes || ''}
            onChange={(e) => onExtraMinutes(Math.max(0, parseInt(e.target.value, 10) || 0))}
          />
        </div>
        {extraMinutes > 0 && (
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Reason for extra work</label>
            <textarea
              className={styles.notesInput}
              rows={2}
              placeholder="Why the job took longer than estimated…"
              value={extraWorkNote}
              onChange={(e) => onExtraWorkNote(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Phase 2.5 F1 — pay breakdown */}
      <div className={styles.summaryCard}>
        <p className={styles.summarySection}>Pay breakdown</p>
        <div className={styles.summaryPartRow}>
          <span>Parts</span><span /><span className={styles.summaryPartCost}>€{pay.partsCost.toFixed(2)}</span>
        </div>
        <div className={styles.summaryPartRow}>
          <span>Labour ({estimatedMinutes} min est.)</span><span /><span className={styles.summaryPartCost}>€{pay.labourCost.toFixed(2)}</span>
        </div>
        {pay.extraCost > 0 && (
          <div className={styles.summaryPartRow}>
            <span>Extra ({extraMinutes} min)</span><span /><span className={styles.summaryPartCost}>€{pay.extraCost.toFixed(2)}</span>
          </div>
        )}
        <div className={styles.summaryTotal}>
          <span>Total</span>
          <span>€{pay.totalCost.toFixed(2)}</span>
        </div>
        <p className={styles.summaryNone} style={{ marginTop: 6, fontSize: 12 }}>
          Subject to admin approval before payment.
        </p>
      </div>

      {/* #99: show write failure so user can retry */}
      {completeErr && (
        <div style={{ color: 'var(--status-red)', fontSize: 13, textAlign: 'center', marginBottom: 8 }}>
          {completeErr}
        </div>
      )}
      <button
        className={styles.completeBtn}
        onClick={onComplete}
        disabled={completing}
      >
        {completing
          ? <><Loader2 size={18} className={styles.spin} /> Saving…</>
          : completeErr ? 'Retry' : 'Complete Repair'}
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function RepairSession() {
  const { ticketId } = useParams();
  const navigate = useNavigate();
  const { user, userProfile } = useAuth();
  const { tickets, parts, config } = useMaintenance();
  const { procedures } = useRepairProcedures();
  const labourRatePerHour = config?.labourRatePerHour ?? 0;

  const ticket    = useMemo(() => tickets.find((t) => t._docId === ticketId), [tickets, ticketId]);

  // #bug-449 — collect ALL procedures matching this ticket's category
  const matchingProcedures = useMemo(() => {
    if (!ticket) return [];
    return procedures.filter((p) => p.category === ticket.category);
  }, [ticket, procedures]);

  const [selectedProcedureId, setSelectedProcedureId] = useState(null);

  // #bug-449 — resolve the single active procedure:
  // 0 matches → FALLBACK, 1 match → auto-select, 2+ → null until tech chooses
  const procedure = useMemo(() => {
    if (!ticket) return FALLBACK_PROCEDURE;
    if (matchingProcedures.length === 0) return FALLBACK_PROCEDURE;
    if (matchingProcedures.length === 1) return matchingProcedures[0];
    return matchingProcedures.find((p) => p.id === selectedProcedureId) ?? null;
  }, [ticket, matchingProcedures, selectedProcedureId]);

  // #403 — persist sessionId in sessionStorage so navigate-away + return reuses the same
  // session ID rather than generating a new one (which would duplicate stock decrements).
  const [sessionId] = useState(() => {
    const key = `omni_repair_session_${ticketId}`;
    const stored = sessionStorage.getItem(key);
    if (stored) return stored;
    const id = sessionIdFor(ticketId);
    sessionStorage.setItem(key, id);
    return id;
  });
  // #418 — persist startedAt to sessionStorage so navigate-away/return preserves
  // the original start time and labour-minutes calculation stays correct.
  const [startedAt] = useState(() => {
    const key = `omni_repair_started_${ticketId}`;
    const stored = sessionStorage.getItem(key);
    if (stored) return new Date(stored);
    const now = new Date();
    sessionStorage.setItem(key, now.toISOString());
    return now;
  });
  const [currentStep,  setCurrentStep]  = useState(0);
  const [showSummary,  setShowSummary]  = useState(false);
  const [completing,   setCompleting]   = useState(false);
  const [completeErr,  setCompleteErr]  = useState(null);
  const [stepError,    setStepError]    = useState(null);
  // Phase 2.5 F1 — technician-logged extra work (beyond the procedure estimate).
  const [extraMinutes,  setExtraMinutes]  = useState(0);
  const [extraWorkNote, setExtraWorkNote] = useState('');

  // #419 — Per-step state: { notes, partsUsed, photoUrls, completedAt }
  // Initialise from sessionStorage so that closing the tab mid-repair preserves
  // notes, photos, and partsUsed. Procedure may be null (disambiguation screen),
  // so we start with [] and populate via useEffect once procedure is resolved.
  const [stepData, setStepData] = useState(() => {
    const key = `omni_repair_steps_${ticketId}`;
    const stored = sessionStorage.getItem(key);
    if (stored) {
      try { return JSON.parse(stored); } catch { /* ignore corrupt cache */ }
    }
    return [];
  });

  // #419 — when procedure becomes available (including disambiguation resolution),
  // populate stepData if it is still empty (first load or after cache miss).
  useEffect(() => {
    if (!procedure) return;
    setStepData((prev) => {
      if (prev.length > 0) return prev; // already hydrated from sessionStorage or prior effect
      const initial = (procedure.steps ?? []).map((s) => ({
        stepNumber: s.stepNumber,
        notes:      '',
        photoUrls:  [],
        partsUsed:  (procedure.commonParts ?? []).map((cp) => ({
          partId:   cp.partId,
          partName: cp.partName,
          quantity: cp.defaultQty ?? 1,
          unitCost: parts.find((p) => p._docId === cp.partId)?.unitCost ?? 0,
        })),
        completedAt: null,
      }));
      sessionStorage.setItem(`omni_repair_steps_${ticketId}`, JSON.stringify(initial));
      return initial;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procedure]);

  const steps = procedure ? (procedure.steps ?? []) : [];
  const step  = steps[currentStep];
  const data  = stepData[currentStep] ?? { notes: '', partsUsed: [], photoUrls: [] };

  // #419 — updateData now also persists to sessionStorage on every call
  const updateData = useCallback((key, val) => {
    setStepData((prev) => {
      const next = prev.map((d, i) => i === currentStep ? { ...d, [key]: val } : d);
      sessionStorage.setItem(`omni_repair_steps_${ticketId}`, JSON.stringify(next));
      return next;
    });
  }, [currentStep, ticketId]);

  function handleMarkDone() {
    // #101: enforce photo requirement before advancing
    if (step.requiresPhoto && (!data.photoUrls || data.photoUrls.length === 0)) {
      setStepError('Photo required for this step');
      return;
    }
    setStepError(null);
    // #419 — persist completedAt stamp to sessionStorage as well
    setStepData((prev) => {
      const next = prev.map((d, i) =>
        i === currentStep ? { ...d, completedAt: new Date().toISOString() } : d
      );
      sessionStorage.setItem(`omni_repair_steps_${ticketId}`, JSON.stringify(next));
      return next;
    });
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      setShowSummary(true);
    }
  }

  // #450 — back navigation within session; only exit to /technician from step 0
  function handleBack() {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
      setStepError(null);
    } else {
      navigate('/technician');
    }
  }

  async function handleComplete() {
    setCompleting(true);
    try {
      await completeRepairSession({
        ticketDocId:    ticketId,
        sessionId,
        procedureId:    procedure.id,
        scooterId:      ticket?.scooterId ?? '',
        technicianUid:  user?.uid ?? '',
        technicianName: userProfile?.displayName ?? '',
        startedAt,
        completedAt:    new Date(),
        steps:          stepData,
        // Phase 2.5 F1 — pay inputs (estimate from the procedure, rate from org config).
        estimatedMinutes:  procedure.estimatedMinutes ?? 0,
        labourRatePerHour,
        extraMinutes,
        extraWorkNote,
      });
      // #403 — clear the persisted session ID on success so re-opening this ticket
      // (if ever re-opened) gets a fresh session rather than the completed one.
      sessionStorage.removeItem(`omni_repair_session_${ticketId}`);
      // #418 — clear the persisted startedAt so a re-opened ticket gets a fresh start.
      sessionStorage.removeItem(`omni_repair_started_${ticketId}`);
      // #419 — clear the persisted step data after a successful commit.
      sessionStorage.removeItem(`omni_repair_steps_${ticketId}`);
      navigate('/technician');
    } catch (err) {
      console.error('Failed to complete repair session:', err);
      // #99: surface write failures visibly; keep form active for retry
      setCompleteErr(err.message || 'Failed to save repair. Please try again.');
      setCompleting(false);
    }
  }

  if (!ticket) {
    return (
      <div className={styles.shell}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={() => navigate('/technician')}><ArrowLeft size={20} /></button>
          <span className={styles.headerTitle}>Repair</span>
        </header>
        <div className={styles.notFound}>Ticket not found or already removed.</div>
      </div>
    );
  }

  // #bug-449 — disambiguation screen when multiple procedures share this ticket's category
  if (!procedure) {
    return (
      <div className={styles.shell}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={() => navigate('/technician')} aria-label="Back">
            <ArrowLeft size={20} />
          </button>
          <span className={styles.headerTitle}>Choose Procedure</span>
        </header>
        <div className={styles.procedurePicker}>
          <p className={styles.procedurePickerHint}>Multiple SOPs match this ticket. Select the correct one:</p>
          {matchingProcedures.map((p) => (
            <button key={p.id} className={styles.procedurePickerBtn} onClick={() => setSelectedProcedureId(p.id)}>
              {p.title ?? p.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (showSummary) {
    return (
      <div className={styles.shell}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={() => setShowSummary(false)}><ArrowLeft size={20} /></button>
          <span className={styles.headerTitle}>{ticket.scooterId} · Summary</span>
        </header>
        <SummaryScreen
          procedure={procedure}
          stepData={stepData}
          startedAt={startedAt}
          onComplete={handleComplete}
          completing={completing}
          completeErr={completeErr}
          labourRatePerHour={labourRatePerHour}
          extraMinutes={extraMinutes}
          extraWorkNote={extraWorkNote}
          onExtraMinutes={setExtraMinutes}
          onExtraWorkNote={setExtraWorkNote}
        />
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      {/* Header */}
      <header className={styles.header}>
        {/* #450 — back goes to previous step (not exit) when currentStep > 0 */}
        <button className={styles.backBtn} onClick={handleBack} aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <div className={styles.headerCenter}>
          <span className={styles.headerTitle}>{ticket.scooterId}</span>
          <span className={styles.headerSub}>{procedure.title}</span>
        </div>
        <span className={styles.stepCounter}>{currentStep + 1}/{steps.length}</span>
      </header>

      {/* Progress bar — #450: each completed segment is clickable to jump back */}
      <div className={styles.progressBar}>
        {steps.map((_, i) => (
          <button
            key={i}
            className={
              i < currentStep
                ? `${styles.progressSegment} ${styles.progressSegmentCompleted}`
                : i === currentStep
                  ? `${styles.progressSegment} ${styles.progressSegmentCurrent}`
                  : styles.progressSegment
            }
            style={{ width: `${100 / steps.length}%` }}
            onClick={() => { if (i <= currentStep) { setCurrentStep(i); setStepError(null); } }}
            aria-label={`Go to step ${i + 1}`}
            disabled={i > currentStep}
          />
        ))}
      </div>

      {/* Step content */}
      <main className={styles.main}>
        <div className={styles.stepCard}>
          <div className={styles.stepNumBadge}>{step.stepNumber}</div>
          <p className={styles.stepInstruction}>{step.instruction}</p>
          {step.notes && <p className={styles.stepHint}>{step.notes}</p>}
        </div>

        {/* Notes */}
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Notes (optional)</label>
          <textarea
            className={styles.notesInput}
            placeholder="Observations, measurements, anything unusual…"
            rows={3}
            value={data.notes}
            onChange={(e) => updateData('notes', e.target.value)}
          />
        </div>

        {/* Photo */}
        {step.requiresPhoto && (
          <div className={styles.field}>
            <label className={styles.fieldLabel}>
              Photo required
            </label>
            <PhotoUpload
              sessionId={sessionId}
              stepNumber={step.stepNumber}
              photoUrls={data.photoUrls}
              onChange={(urls) => updateData('photoUrls', urls)}
            />
          </div>
        )}

        {/* Parts */}
        <StepPartsEditor
          partsUsed={data.partsUsed}
          onUpdate={(val) => updateData('partsUsed', val)}
          allParts={parts}
        />
      </main>

      {/* Footer CTA */}
      {/* #101: show validation error when photo is required but missing */}
      {stepError && (
        <div style={{ color: 'var(--status-red)', fontSize: 13, padding: '4px 16px', textAlign: 'center' }}>
          {stepError}
        </div>
      )}
      <div className={styles.footer}>
        <span className={styles.elapsedLabel}><Clock size={13} /> {elapsed(startedAt)}</span>
        <button
          className={styles.nextBtn}
          onClick={handleMarkDone}
          disabled={step.requiresPhoto && data.photoUrls.length === 0}
        >
          {currentStep < steps.length - 1 ? (
            <>Next step <ChevronRight size={18} /></>
          ) : (
            <>Review & Complete <ChevronRight size={18} /></>
          )}
        </button>
      </div>
    </div>
  );
}
