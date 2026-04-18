import { useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ChevronRight, CheckCircle2, Package, Plus, Minus,
  Clock, Wrench, Search, X, Loader2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useMaintenance } from '../../context/MaintenanceContext.jsx';
import { useRepairProcedures } from '../../context/RepairProcedureContext.jsx';
import PhotoUpload from './PhotoUpload.jsx';
import { completeRepairSession } from '../../utils/repairSessionWriter.js';
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
          {filtered.map((p) => (
            <li
              key={p._docId}
              className={styles.partDropdownItem}
              onMouseDown={() => {
                onAdd({ partId: p._docId, partName: p.partName, quantity: 1, unitCost: p.unitCost ?? 0 });
                setQuery('');
                setOpen(false);
              }}
            >
              <span>{p.partName}</span>
              <span className={styles.partDropdownSku}>{p.sku}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Parts list for a step ─────────────────────────────────────────────────────
function StepPartsEditor({ partsUsed, onUpdate, allParts }) {
  function setQty(idx, delta) {
    const next = partsUsed.map((p, i) =>
      i === idx ? { ...p, quantity: Math.max(1, p.quantity + delta) } : p
    );
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
      onUpdate([...partsUsed, part]);
    }
  }

  return (
    <div className={styles.partsEditor}>
      <p className={styles.partsLabel}>Parts used this step</p>
      {partsUsed.length > 0 && (
        <div className={styles.partRows}>
          {partsUsed.map((p, idx) => (
            <div key={idx} className={styles.partRow}>
              <span className={styles.partName}>{p.partName}</span>
              <div className={styles.qtyControl}>
                <button className={styles.qtyBtn} onClick={() => setQty(idx, -1)}><Minus size={12} /></button>
                <span className={styles.qtyVal}>{p.quantity}</span>
                <button className={styles.qtyBtn} onClick={() => setQty(idx, 1)}><Plus size={12} /></button>
              </div>
              <button className={styles.removePartBtn} onClick={() => remove(idx)}><X size={13} /></button>
            </div>
          ))}
        </div>
      )}
      <PartPicker parts={allParts} onAdd={addPart} />
    </div>
  );
}

// ── Summary screen ────────────────────────────────────────────────────────────
function SummaryScreen({ procedure, stepData, startedAt, onComplete, completing }) {
  const allParts = {};
  stepData.forEach((s) => {
    (s.partsUsed ?? []).forEach(({ partId, partName, quantity, unitCost }) => {
      if (!allParts[partId]) allParts[partId] = { partName, quantity: 0, unitCost: unitCost ?? 0 };
      allParts[partId].quantity += quantity;
    });
  });
  const aggregated = Object.values(allParts);
  const totalCost  = aggregated.reduce((s, p) => s + p.quantity * p.unitCost, 0);

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
        {aggregated.length > 0 && (
          <div className={styles.summaryTotal}>
            <span>Total parts cost</span>
            <span>€{totalCost.toFixed(2)}</span>
          </div>
        )}
      </div>

      <button
        className={styles.completeBtn}
        onClick={onComplete}
        disabled={completing}
      >
        {completing
          ? <><Loader2 size={18} className={styles.spin} /> Saving…</>
          : 'Complete Repair'}
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function RepairSession() {
  const { ticketId } = useParams();
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  const { tickets, parts } = useMaintenance();
  const { procedures } = useRepairProcedures();

  const ticket    = useMemo(() => tickets.find((t) => t._docId === ticketId), [tickets, ticketId]);
  const procedure = useMemo(() => {
    if (!ticket) return FALLBACK_PROCEDURE;
    return procedures.find((p) => p.category === ticket.category) ?? FALLBACK_PROCEDURE;
  }, [ticket, procedures]);

  const [sessionId]   = useState(() => sessionIdFor(ticketId));
  const [startedAt]   = useState(() => new Date());
  const [currentStep, setCurrentStep] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [completing,  setCompleting]  = useState(false);

  // Per-step state: { notes, partsUsed, photoUrls, completedAt }
  const [stepData, setStepData] = useState(() =>
    (procedure.steps ?? []).map((s) => ({
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
    }))
  );

  const steps = procedure.steps ?? [];
  const step  = steps[currentStep];
  const data  = stepData[currentStep] ?? { notes: '', partsUsed: [], photoUrls: [] };

  const updateData = useCallback((key, val) => {
    setStepData((prev) => prev.map((d, i) => i === currentStep ? { ...d, [key]: val } : d));
  }, [currentStep]);

  function handleMarkDone() {
    setStepData((prev) => prev.map((d, i) =>
      i === currentStep ? { ...d, completedAt: new Date().toISOString() } : d
    ));
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      setShowSummary(true);
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
        technicianUid:  userProfile?.uid ?? '',
        technicianName: userProfile?.displayName ?? '',
        startedAt,
        completedAt:    new Date(),
        steps:          stepData,
      });
      navigate('/technician');
    } catch (err) {
      console.error('Failed to complete repair session:', err);
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
        />
      </div>
    );
  }

  const progress = ((currentStep) / steps.length) * 100;

  return (
    <div className={styles.shell}>
      {/* Header */}
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/technician')} aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <div className={styles.headerCenter}>
          <span className={styles.headerTitle}>{ticket.scooterId}</span>
          <span className={styles.headerSub}>{procedure.title}</span>
        </div>
        <span className={styles.stepCounter}>{currentStep + 1}/{steps.length}</span>
      </header>

      {/* Progress bar */}
      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: `${progress}%` }} />
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
