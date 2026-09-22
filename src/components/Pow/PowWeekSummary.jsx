import { useMemo, useState } from 'react';
import { ClipboardCopy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { usePow } from '../../context/PowContext.jsx';
import { powWeekSummary, powSummaryText } from '../../utils/powSummary.js';
import styles from './PowWeekSummary.module.css';

/**
 * PowWeekSummary — Autopilot Phase 4. Last week's recap, drafted for you:
 * what got done, what carries over, what was added. Copy it into WhatsApp or an
 * email; nothing is sent automatically. Collapsed by default after Monday so it
 * stays out of the way for the rest of the week.
 */
export default function PowWeekSummary() {
  const { tasks = [], computedWeek } = usePow();
  const lastWeek = Math.max(1, (computedWeek || 1) - 1);
  const summary = useMemo(() => powWeekSummary(tasks, lastWeek), [tasks, lastWeek]);
  const isMonday = new Date().getDay() === 1;
  const [open, setOpen] = useState(isMonday);
  const [copied, setCopied] = useState(false);

  const empty = !summary.done.length && !summary.carried.length && !summary.added.length;
  if (empty) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(powSummaryText(summary));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the text is on screen anyway */ }
  };

  return (
    <section className={styles.card} aria-labelledby="pow-recap-title">
      <button type="button" className={styles.head} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span id="pow-recap-title" className={styles.title}>Week {summary.week} recap</span>
        <span className={styles.counts}>
          {summary.done.length} done · {summary.carried.length} carried · {summary.added.length} new
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className={styles.body}>
          {summary.done.length > 0 && (
            <div>
              <p className={styles.group}>Done</p>
              <ul className={styles.list}>{summary.done.map((t) => <li key={t.id}>{t.title}</li>)}</ul>
            </div>
          )}
          {summary.carried.length > 0 && (
            <div>
              <p className={styles.group}>Carried into this week</p>
              <ul className={styles.list}>{summary.carried.map((t) => <li key={t.id}>{t.title}</li>)}</ul>
            </div>
          )}
          {summary.added.length > 0 && (
            <div>
              <p className={styles.group}>New in the backlog</p>
              <ul className={styles.list}>{summary.added.map((t) => <li key={t.id}>{t.title}</li>)}</ul>
            </div>
          )}
          <button type="button" className={styles.copy} onClick={copy}>
            {copied ? <Check size={14} /> : <ClipboardCopy size={14} />}
            {copied ? 'Copied' : 'Copy recap'}
          </button>
        </div>
      )}
    </section>
  );
}
