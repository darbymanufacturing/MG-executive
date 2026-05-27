import { useState, useEffect } from 'react';
import { Sparkles, Check, ArrowRight, X } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';
import { useAuth } from '../../context/AuthContext.jsx';
import styles from './DailyBrief.module.css';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

const FALLBACK_BRIEF = {
  narrative: 'Your daily brief is being prepared…',
  yesterday: ['Check back soon for yesterday\'s summary.'],
  today: ['Open Inbox to review what needs your attention.'],
};

export default function DailyBrief() {
  const { user } = useAuth();
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  /* Check if already dismissed today */
  useEffect(() => {
    const key = `omni_brief_dismissed_${todayKey()}`;
    if (localStorage.getItem(key)) setDismissed(true);
  }, []);

  /* Fetch brief from Firestore */
  useEffect(() => {
    if (!user || dismissed) return;
    const key = `${todayKey()}_${user.uid}`;
    getDoc(doc(db, 'briefs', key))
      .then(snap => {
        if (snap.exists()) {
          const data = snap.data();
          setBrief({
            date: new Date().toLocaleDateString('en-GB', { weekday: 'long', month: 'long', day: 'numeric' }),
            narrative: data.narrative || FALLBACK_BRIEF.narrative,
            yesterday: data.sections?.find(s => s.title === 'Yesterday')?.items || FALLBACK_BRIEF.yesterday,
            today: data.sections?.find(s => s.title === 'Today')?.items || FALLBACK_BRIEF.today,
          });
        } else {
          setBrief({
            date: new Date().toLocaleDateString('en-GB', { weekday: 'long', month: 'long', day: 'numeric' }),
            ...FALLBACK_BRIEF,
          });
        }
        setLoading(false);
      })
      .catch(() => {
        setBrief({ date: new Date().toLocaleDateString('en-GB', { weekday: 'long', month: 'long', day: 'numeric' }), ...FALLBACK_BRIEF });
        setLoading(false);
      });
  }, [user, dismissed]);

  const handleDismiss = () => {
    const key = `omni_brief_dismissed_${todayKey()}`;
    localStorage.setItem(key, '1');
    setDismissed(true);
  };

  if (dismissed) return null;

  if (loading) {
    return (
      <div className={`card ${styles.briefCollapsed}`}>
        <Sparkles size={16} className={styles.sparkle} />
        <span className={styles.collapsedText}>
          <strong>Daily Brief</strong> · Loading…
        </span>
      </div>
    );
  }

  return (
    <div className={styles.brief}>
      <div className={styles.header}>
        <Sparkles size={16} className={styles.sparkle} />
        <span className="eyebrow">Daily Brief</span>
        <span className={styles.date}>· {brief?.date}</span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-xs btn-sm" title="Dismiss for today" onClick={handleDismiss}>
          <X size={12} />
        </button>
      </div>

      <p className={styles.narrative}>{brief?.narrative}</p>

      <div className={styles.cols}>
        <div>
          <div className={styles.colLabel}>Yesterday</div>
          {brief?.yesterday?.map((t, i) => (
            <div key={i} className={styles.colItem}>
              <Check size={13} className={styles.iconGreen} />{t}
            </div>
          ))}
        </div>
        <div>
          <div className={styles.colLabel}>Today</div>
          {brief?.today?.map((t, i) => (
            <div key={i} className={styles.colItem}>
              <ArrowRight size={13} className={styles.iconAccent} />{t}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
