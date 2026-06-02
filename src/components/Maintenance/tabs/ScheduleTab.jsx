import { useState, useMemo } from 'react';
import { CalendarClock, Plus, Check, Wrench, Trash2, Repeat, X, AlertTriangle } from 'lucide-react';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import styles from './ScheduleTab.module.css';

const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'One-off (no repeat)' },
  { value: 'days', label: 'Every N days' },
  { value: 'weeks', label: 'Every N weeks' },
  { value: 'months', label: 'Every N months' },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function recurrenceLabel(s) {
  if (!s.recurrence || s.recurrence === 'none') return 'One-off';
  const n = Number(s.interval) || 1;
  const unit = s.recurrence === 'days' ? 'day' : s.recurrence === 'weeks' ? 'week' : 'month';
  return `Every ${n} ${unit}${n > 1 ? 's' : ''}`;
}

function dueMeta(nextDue, today) {
  if (!nextDue) return { label: '—', tone: 'muted' };
  const diffDays = Math.round(
    (new Date(`${nextDue}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86_400_000,
  );
  if (Number.isNaN(diffDays)) return { label: nextDue, tone: 'muted' };
  if (diffDays < 0) return { label: `Overdue ${Math.abs(diffDays)}d`, tone: 'overdue' };
  if (diffDays === 0) return { label: 'Due today', tone: 'soon' };
  if (diffDays <= 7) return { label: `Due in ${diffDays}d`, tone: 'soon' };
  return { label: nextDue, tone: 'ok' };
}

export default function ScheduleTab() {
  const {
    schedules = [],
    schedulesLoading,
    scooters = [],
    addSchedule,
    deleteSchedule,
    markScheduleDone,
    addTicket,
  } = useMaintenance();
  const { success: toastSuccess, error: toastError } = useToast();
  const today = todayStr();

  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    scooterId: '', title: '', notes: '', nextDue: today, recurrence: 'none', interval: 30,
  });

  const sorted = useMemo(() => {
    const active = schedules.filter((s) => s.status !== 'done');
    const done = schedules.filter((s) => s.status === 'done');
    active.sort((a, b) => String(a.nextDue || '').localeCompare(String(b.nextDue || '')));
    done.sort((a, b) => String(b.lastCompleted || '').localeCompare(String(a.lastCompleted || '')));
    return { active, done };
  }, [schedules]);

  const scooterOptions = useMemo(
    () =>
      [...scooters].sort((a, b) =>
        String(a.scooterId).localeCompare(String(b.scooterId), undefined, { numeric: true }),
      ),
    [scooters],
  );

  const valid = form.scooterId && form.title.trim() && form.nextDue;

  function reset() {
    setForm({ scooterId: '', title: '', notes: '', nextDue: today, recurrence: 'none', interval: 30 });
    setShowForm(false);
  }

  async function handleSave() {
    if (!valid) return;
    setBusy(true);
    try {
      await addSchedule({
        scooterId: form.scooterId,
        title: form.title.trim(),
        notes: form.notes.trim(),
        nextDue: form.nextDue,
        recurrence: form.recurrence,
        interval: form.recurrence === 'none' ? null : Number(form.interval) || 1,
        lastCompleted: null,
      });
      toastSuccess('Maintenance scheduled.');
      reset();
    } catch (err) {
      toastError(err.message || 'Could not save the schedule.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDone(s) {
    try {
      await markScheduleDone(s._docId);
      toastSuccess(
        s.recurrence && s.recurrence !== 'none' ? 'Serviced — rolled to next due date.' : 'Marked serviced.',
      );
    } catch (err) {
      toastError(err.message || 'Could not update the schedule.');
    }
  }

  async function handleCreateTicket(s) {
    try {
      const scooter = scooters.find((x) => String(x.scooterId) === String(s.scooterId));
      await addTicket({
        scooterId: s.scooterId,
        issueDescription: s.notes ? `${s.title} — ${s.notes}` : s.title,
        dateEntered: today,
        status: 'Active',
        category: 'M',
        city: scooter?.city ?? '',
        source: 'scheduled-maintenance',
      });
      toastSuccess(`Ticket created for #${s.scooterId}.`);
    } catch (err) {
      toastError(err.message || 'Could not create the ticket.');
    }
  }

  async function handleDelete(s) {
    try {
      await deleteSchedule(s._docId);
      toastSuccess('Schedule removed.');
    } catch (err) {
      toastError(err.message || 'Could not remove the schedule.');
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div>
          <h2 className={styles.title}>
            <CalendarClock size={18} /> Scheduled maintenance
          </h2>
          <p className={styles.sub}>
            Plan one-off or recurring servicing per scooter. Due items become a ticket in one click;
            recurring ones roll to the next date when marked serviced.
          </p>
        </div>
        <button className={styles.addBtn} onClick={() => setShowForm((v) => !v)}>
          {showForm ? <X size={15} /> : <Plus size={15} />}
          {showForm ? 'Close' : 'Add schedule'}
        </button>
      </div>

      {showForm && (
        <div className={styles.form}>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span className={styles.label}>Scooter</span>
              <select
                className={styles.input}
                value={form.scooterId}
                onChange={(e) => setForm((f) => ({ ...f, scooterId: e.target.value }))}
              >
                <option value="">Select a scooter…</option>
                {scooterOptions.map((s) => (
                  <option key={s._docId ?? s.scooterId} value={s.scooterId}>
                    #{s.scooterId}
                    {s.city ? ` · ${s.city}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Service</span>
              <input
                className={styles.input}
                placeholder="e.g. Brake & tyre check"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>First due</span>
              <input
                type="date"
                className={styles.input}
                value={form.nextDue}
                onChange={(e) => setForm((f) => ({ ...f, nextDue: e.target.value }))}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Repeat</span>
              <select
                className={styles.input}
                value={form.recurrence}
                onChange={(e) => setForm((f) => ({ ...f, recurrence: e.target.value }))}
              >
                {RECURRENCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {form.recurrence !== 'none' && (
              <label className={styles.field}>
                <span className={styles.label}>Every (interval)</span>
                <input
                  type="number"
                  min="1"
                  className={styles.input}
                  value={form.interval}
                  onChange={(e) => setForm((f) => ({ ...f, interval: e.target.value }))}
                />
              </label>
            )}
            <label className={`${styles.field} ${styles.fieldWide}`}>
              <span className={styles.label}>Notes (optional)</span>
              <input
                className={styles.input}
                placeholder="Anything the technician should know"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </label>
          </div>
          <div className={styles.formActions}>
            <button className={styles.ghostBtn} onClick={reset} disabled={busy}>
              Cancel
            </button>
            <button className={styles.primaryBtn} onClick={handleSave} disabled={!valid || busy}>
              {busy ? 'Saving…' : 'Schedule it'}
            </button>
          </div>
        </div>
      )}

      {schedulesLoading ? (
        <div className={styles.empty}>Loading schedules…</div>
      ) : schedules.length === 0 ? (
        <div className={styles.empty}>
          <CalendarClock size={40} className={styles.emptyIcon} />
          <p className={styles.emptyTitle}>Nothing scheduled yet</p>
          <p className={styles.emptyDesc}>
            Add a recurring service (e.g. a 90-day brake check) or a one-off date for any scooter.
          </p>
        </div>
      ) : (
        <div className={styles.table}>
          <div className={styles.tHead}>
            <span>Scooter</span>
            <span>Service</span>
            <span>Next due</span>
            <span>Repeat</span>
            <span className={styles.right}>Actions</span>
          </div>

          {sorted.active.map((s) => {
            const due = dueMeta(s.nextDue, today);
            const rec = recurrenceLabel(s);
            return (
              <div key={s._docId} className={styles.row}>
                <span className={styles.scooter}>#{s.scooterId}</span>
                <span className={styles.svc}>
                  <span className={styles.svcTitle}>{s.title}</span>
                  {s.notes && <span className={styles.svcNotes}>{s.notes}</span>}
                </span>
                <span>
                  <span className={`${styles.due} ${styles[`due_${due.tone}`]}`}>
                    {due.tone === 'overdue' && <AlertTriangle size={11} />}
                    {due.label}
                  </span>
                </span>
                <span className={styles.repeat}>
                  {rec !== 'One-off' && <Repeat size={12} />}
                  {rec}
                </span>
                <span className={`${styles.right} ${styles.actions}`}>
                  <button className={styles.actionTicket} title="Create a ticket for this service" onClick={() => handleCreateTicket(s)}>
                    <Wrench size={13} /> Ticket
                  </button>
                  <button className={styles.actionDone} title="Mark serviced (recurring rolls to next date)" onClick={() => handleDone(s)}>
                    <Check size={13} /> Done
                  </button>
                  <button className={styles.actionDel} title="Delete schedule" aria-label="Delete schedule" onClick={() => handleDelete(s)}>
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
            );
          })}

          {sorted.done.length > 0 && (
            <>
              <div className={styles.doneHead}>Completed one-offs</div>
              {sorted.done.map((s) => (
                <div key={s._docId} className={`${styles.row} ${styles.rowDone}`}>
                  <span className={styles.scooter}>#{s.scooterId}</span>
                  <span className={styles.svc}>
                    <span className={styles.svcTitle}>{s.title}</span>
                  </span>
                  <span className={styles.doneDate}>Done {s.lastCompleted || '—'}</span>
                  <span className={styles.repeat}>One-off</span>
                  <span className={`${styles.right} ${styles.actions}`}>
                    <button className={styles.actionDel} title="Delete" aria-label="Delete schedule" onClick={() => handleDelete(s)}>
                      <Trash2 size={13} />
                    </button>
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
