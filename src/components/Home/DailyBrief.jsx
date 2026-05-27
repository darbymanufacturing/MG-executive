import { useState, useEffect, useRef, useContext } from 'react';
import { Sparkles, Check, ArrowRight, X } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';
import { useAuth } from '../../context/AuthContext.jsx';
import styles from './DailyBrief.module.css';

/* ─── Helpers ─── */
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function todayLabel() {
  return new Date().toLocaleDateString('en-GB', { weekday: 'long', month: 'long', day: 'numeric' });
}

function parseBriefData(data) {
  const sections = data.sections || [];
  const find = (keywords) => sections.find(s =>
    keywords.some(k => s.title?.toLowerCase().includes(k))
  );
  return {
    date: todayLabel(),
    narrative: data.narrative || '',
    yesterday: find(['yesterday', 'overnight'])?.items || [],
    today:     find(['today', 'attention', 'needs'])?.items || [],
    extra:     find(['positive', 'signal', 'good'])?.items || [],
  };
}

/* ─── Loading states ─── */
function BriefCollapsed({ text }) {
  return (
    <div className={`card ${styles.briefCollapsed}`}>
      <Sparkles size={16} className={styles.sparkle} />
      <span className={styles.collapsedText}>
        <strong>Daily Brief</strong> · {text}
      </span>
    </div>
  );
}

export default function DailyBrief() {
  const { user } = useAuth();
  const [brief, setBrief] = useState(null);
  const [status, setStatus] = useState('loading'); /* loading | generating | ready | error */
  const [dismissed, setDismissed] = useState(false);
  const hasFetched = useRef(false);

  /* Check if dismissed today */
  useEffect(() => {
    if (localStorage.getItem(`omni_brief_dismissed_${todayKey()}`)) {
      setDismissed(true);
    }
  }, []);

  useEffect(() => {
    if (!user || dismissed || hasFetched.current) return;
    hasFetched.current = true;

    const briefKey = `${todayKey()}_${user.uid}`;

    async function fetchOrGenerate() {
      try {
        /* 1. Check Firestore for today's brief */
        const snap = await getDoc(doc(db, 'briefs', briefKey));

        if (snap.exists()) {
          setBrief(parseBriefData(snap.data()));
          setStatus('ready');
          return;
        }

        /* 2. None found — call API to generate */
        setStatus('generating');

        const res = await fetch('/api/daily-brief', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.uid,
            date: todayKey(),
            /* Passing minimal data — the API generates a brief
               asking the user to open the app. Once we have server-side
               aggregation (firebase-admin), this will be richer. */
            data: {
              openIssues:      [],
              overdueTickets:  [],
              activeTickets:   0,
              completedToday:  0,
              openProjects:    [],
              revenueThisWeek: 0,
              revenuePrevWeek: 0,
              costsThisMonth:  0,
              criticalIssues:  0,
              fleetSize:       0,
              inRepair:        0,
            },
          }),
        });

        if (res.ok) {
          const generated = await res.json();
          /* Save to Firestore so it's there on next open */
          await setDoc(doc(db, 'briefs', briefKey), {
            userId: user.uid,
            date: todayKey(),
            narrative: generated.narrative,
            sections: generated.sections,
            generatedAt: generated.generatedAt,
          }).catch(() => {}); /* Don't fail if Firestore write errors */

          setBrief(parseBriefData(generated));
          setStatus('ready');
        } else {
          /* API down — show a soft fallback, don't error out */
          setBrief({
            date: todayLabel(),
            narrative: 'Brief generation is loading. Check back in a moment.',
            yesterday: [],
            today: ['Open Inbox to review what needs your attention today.'],
            extra: [],
          });
          setStatus('ready');
        }
      } catch {
        setStatus('error');
      }
    }

    fetchOrGenerate();
  }, [user, dismissed]);

  const handleDismiss = () => {
    localStorage.setItem(`omni_brief_dismissed_${todayKey()}`, '1');
    setDismissed(true);
  };

  /* ─── Render ─── */
  if (dismissed)               return null;
  if (status === 'loading')    return <BriefCollapsed text="Loading…" />;
  if (status === 'generating') return <BriefCollapsed text="Generating your brief…" />;
  if (status === 'error')      return <BriefCollapsed text="Unavailable — open Inbox to triage." />;
  if (!brief)                  return null;

  return (
    <div className={styles.brief}>
      <div className={styles.header}>
        <Sparkles size={16} className={styles.sparkle} />
        <span className="eyebrow">Daily Brief</span>
        <span className={styles.date}>· {brief.date}</span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-xs" title="Dismiss for today" onClick={handleDismiss}>
          <X size={12} />
        </button>
      </div>

      {brief.narrative && <p className={styles.narrative}>{brief.narrative}</p>}

      <div className={styles.cols}>
        {brief.yesterday?.length > 0 && (
          <div>
            <div className={styles.colLabel}>Yesterday</div>
            {brief.yesterday.map((t, i) => (
              <div key={i} className={styles.colItem}>
                <Check size={13} className={styles.iconGreen} />{t}
              </div>
            ))}
          </div>
        )}
        {brief.today?.length > 0 && (
          <div>
            <div className={styles.colLabel}>Needs attention</div>
            {brief.today.map((t, i) => (
              <div key={i} className={styles.colItem}>
                <ArrowRight size={13} className={styles.iconAccent} />{t}
              </div>
            ))}
          </div>
        )}
        {brief.extra?.length > 0 && (
          <div>
            <div className={styles.colLabel}>Positive signals</div>
            {brief.extra.map((t, i) => (
              <div key={i} className={styles.colItem}>
                <Check size={13} className={styles.iconGreen} />{t}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
