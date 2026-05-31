import { useState, useEffect, useRef } from 'react';
import { Sparkles, Check, ArrowRight, X } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useOrg } from '../../context/OrgContext.jsx';
import { useCosts } from '../../context/CostContext.jsx';
import { useRevenue } from '../../context/RevenueContext.jsx';
import { useIssues } from '../../context/IssueContext.jsx';
import { useMaintenance } from '../../context/MaintenanceContext.jsx';
import { useProjects } from '../../context/ProjectContext.jsx';
import { orgDocId } from '../../utils/orgDocId.js';
import { authedFetch } from '../../utils/apiClient.js';
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
  // BUG #161: filter(Boolean) guards against undefined keywords
  const find = (keywords) => sections.find(s =>
    keywords.filter(Boolean).some(k => s.title?.toLowerCase().includes(k))
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

/* ─── Error / unavailable fallback ─── */
function BriefUnavailable({ onRetry }) {
  return (
    <div
      className={`card ${styles.briefCollapsed}`}
      style={{ opacity: 0.6, cursor: 'pointer' }}
      onClick={onRetry}
      role="button"
      title="Tap to retry"
    >
      <Sparkles size={16} className={styles.sparkle} />
      <span className={styles.collapsedText} style={{ color: 'var(--fg-muted)' }}>
        <strong>Daily Brief</strong> · ⚠ Brief unavailable — tap to retry
      </span>
    </div>
  );
}

export default function DailyBrief() {
  const { user } = useAuth();
  const { orgId } = useOrgSafe() ?? {};

  /* Pull real data from contexts for the brief payload */
  const issueCtx       = useIssuesSafe();
  const maintenanceCtx = useMaintenanceSafe();
  const projectCtx     = useProjectsSafe();
  const revenueCtx     = useRevenueSafe();
  const costsCtx       = useCostsSafe();

  const [brief, setBrief] = useState(null);
  const [status, setStatus] = useState('loading'); /* loading | generating | ready | error */
  const [dismissed, setDismissed] = useState(false);
  // BUG #304: retryCount forces effect to re-run on retry
  const [retryCount, setRetryCount] = useState(0);
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

    const rawBriefKey = `${todayKey()}_${user.uid}`;
    // #400: use org-scoped doc ID so cron-purge can query by orgId on org deletion
    const briefKey = orgId ? orgDocId(orgId, rawBriefKey) : rawBriefKey;

    /* ── Build real payload from contexts (BUG #159) ── */
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const openIssuesCount = issueCtx?.activeIssues?.filter(i => i.status !== 'done').length ?? 0;
    const activeTicketsCount = maintenanceCtx?.tickets?.filter(t => t.status === 'Active').length ?? 0;
    const revenueThisMonth = (revenueCtx?.revenueData || [])
      .filter(r => r.date?.startsWith(monthKey))
      .reduce((s, r) => s + (r.totalPaidRevenue || 0), 0);
    const costsThisMonth = (costsCtx?.costs || [])
      .filter(c => c.startDate?.startsWith(monthKey))
      .reduce((s, c) => s + (c.amount || 0), 0);
    const activeProjectsCount = (projectCtx?.projects || [])
      .filter(p => p.effectiveStatus !== 'archived' && !p.archived).length;
    const fleetSize = costsCtx?.config?.fleetSize ?? 0;
    const inRepair = maintenanceCtx?.tickets?.filter(
      t => t.status === 'Active' || t.status === 'Backlog'
    ).length ?? 0;

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

        const res = await authedFetch('/api/daily-brief', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.uid,
            date: todayKey(),
            data: {
              // buildPrompt expects ARRAYS here (it .filter()s + reads titles/names), not counts.
              // Sending counts threw a TypeError → 500 (brief unavailable). Send the real arrays.
              openIssues:      issueCtx?.activeIssues ?? [],
              overdueTickets:  [],
              activeTickets:   activeTicketsCount,
              completedToday:  0,
              openProjects:    projectCtx?.activeProjects ?? [],
              revenueThisWeek: 0,
              revenuePrevWeek: 0,
              revenueThisMonth,
              costsThisMonth,
              criticalIssues:  issueCtx?.activeIssues?.filter(i => i.urgency === 'critical').length ?? 0,
              fleetSize,
              inRepair,
            },
          }),
        });

        if (res.ok) {
          const generated = await res.json();
          /* Save to Firestore so it's there on next open */
          // #400: stamp orgId so cron-purge can clean up after org deletion (GDPR)
          await setDoc(doc(db, 'briefs', briefKey), {
            userId: user.uid,
            orgId: orgId ?? null,
            date: todayKey(),
            narrative: generated.narrative,
            sections: generated.sections,
            generatedAt: generated.generatedAt,
          }).catch(() => {}); /* Don't fail if Firestore write errors */

          setBrief(parseBriefData(generated));
          setStatus('ready');
        } else {
          /* API down — show error state, don't pass it off as a real brief (#304) */
          setStatus('error');
        }
      } catch {
        setStatus('error');
      }
    }

    fetchOrGenerate();

    // BUG #160: reset hasFetched on cleanup so StrictMode remounts (and retries) re-fetch
    return () => {
      hasFetched.current = false;
    };
  }, [user, dismissed, retryCount]); // retryCount forces re-run on manual retry

  const handleDismiss = () => {
    localStorage.setItem(`omni_brief_dismissed_${todayKey()}`, '1');
    setDismissed(true);
  };

  // BUG #304: retry handler — reset state and bump counter
  const handleRetry = () => {
    setBrief(null);
    setStatus('loading');
    setRetryCount(c => c + 1);
  };

  /* ─── Render ─── */
  if (dismissed)               return null;
  if (status === 'loading')    return <BriefCollapsed text="Loading…" />;
  if (status === 'generating') return <BriefCollapsed text="Generating your brief…" />;
  // BUG #304: error state is now visually distinct and retryable
  if (status === 'error')      return <BriefUnavailable onRetry={handleRetry} />;
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

/* Safe hooks — return null if context not mounted */
function useOrgSafe() {
  try { return useOrg(); } catch { return null; }
}
function useIssuesSafe() {
  try { return useIssues(); } catch { return null; }
}
function useMaintenanceSafe() {
  try { return useMaintenance(); } catch { return null; }
}
function useProjectsSafe() {
  try { return useProjects(); } catch { return null; }
}
function useRevenueSafe() {
  try { return useRevenue(); } catch { return null; }
}
function useCostsSafe() {
  try { return useCosts(); } catch { return null; }
}
