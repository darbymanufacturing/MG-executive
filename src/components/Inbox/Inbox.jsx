import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock, Check, ArrowRight, ChevronRight,
  Flag, Wrench, Folder, Receipt, Landmark, AlertTriangle,
} from 'lucide-react';
import { useIssues } from '../../context/IssueContext.jsx';
import { useMaintenance } from '../../context/MaintenanceContext.jsx';
import { useProjects } from '../../context/ProjectContext.jsx';
import styles from './Inbox.module.css';
import EmptyState from '../Shared/EmptyState.jsx';

/* ─── Constants ─── */
const URGENCY = {
  critical: { color: 'var(--status-red)',   bg: 'var(--status-red-bg)',   label: 'Critical · needs attention now' },
  high:     { color: 'var(--status-amber)', bg: 'var(--status-amber-bg)', label: 'High · this week' },
  medium:   { color: 'var(--status-blue)',  bg: 'var(--status-blue-bg)',  label: 'Medium' },
  low:      { color: 'var(--status-grey)',  bg: 'var(--bg-hover)',        label: 'Low · informational' },
};

const SOURCE_ICONS = {
  Flag, Wrench, Folder, Receipt, Landmark, AlertTriangle,
};

function UrgencyDot({ urgency, size = 8 }) {
  const u = URGENCY[urgency] || URGENCY.medium;
  return (
    <span
      className={styles.urgencyDot}
      style={{
        width: size, height: size,
        background: u.color,
        boxShadow: urgency === 'critical' ? `0 0 0 3px ${u.bg}` : 'none',
      }}
    />
  );
}

function SourceBadge({ source, sourceIcon }) {
  const Icon = SOURCE_ICONS[sourceIcon] || Flag;
  return (
    <span className={styles.sourceBadge}>
      <Icon size={11} strokeWidth={2.2} />
      {source}
    </span>
  );
}

function GroupHeading({ label, count }) {
  if (!label) return null;
  return (
    <div className={styles.groupHeading}>
      <span>{label}</span>
      <span className={styles.groupCount}>· {count}</span>
      <div className={styles.groupLine} />
    </div>
  );
}

/* ─── Row variant (default) ─── */
function InboxRowItem({ item, onSnooze, onDone }) {
  const navigate = useNavigate();
  // Items open > 180 days are "stale" — show a neutral badge instead of keeping Critical treatment
  const isVeryStale = item.ageHours > 180 * 24;
  const displayUrgency = isVeryStale ? 'low' : item.urgency;
  const u = URGENCY[displayUrgency] || URGENCY.medium;
  const stale = item.ageHours > 96 && item.urgency === 'low';

  return (
    <div
      className={styles.rowItem}
      style={{ opacity: stale ? 0.72 : 1, cursor: 'pointer' }}
      onClick={() => navigate(item.link)}
      role="row"
    >
      {/* Urgency stripe */}
      <div className={styles.urgencyStripe} style={{ background: u.color }} />

      {/* Dot */}
      <div className={styles.dotCol}>
        <UrgencyDot urgency={displayUrgency} />
      </div>

      {/* Content */}
      <div className={styles.rowContent}>
        <div className={styles.rowMeta}>
          <SourceBadge source={item.source} sourceIcon={item.sourceIcon} />
          <span className={styles.rowAge}>{item.age}</span>
          {isVeryStale && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: 'var(--bg-hover)', color: 'var(--fg-muted)' }}>
              Stale
            </span>
          )}
          {item.owner?.name && (
            <span className={styles.rowOwner}>{item.owner.name}</span>
          )}
        </div>
        <div className={styles.rowTitle}>{item.title}</div>
        {item.nextAction && (
          <div className={styles.rowAction}>
            <ArrowRight size={13} className={styles.actionArrow} />
            <span>{item.nextAction}</span>
          </div>
        )}
      </div>

      {/* Quick actions — only shown for issue items (#162: non-issue kinds have no action handler) */}
      {item.kind === 'issue' && (
        <div className={styles.quickActions} onClick={e => e.stopPropagation()}>
          <button className="btn btn-ghost btn-xs" onClick={() => onSnooze?.(item)} title="Snooze">
            <Clock size={13} />
            <span>Snooze</span>
          </button>
          <button className="btn btn-ghost btn-xs" onClick={() => onDone?.(item)} title="Mark done">
            <Check size={13} />
            <span>Done</span>
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Snooze sheet ─── */
function SnoozeSheet({ item, onClose }) {
  const { snoozeIssue } = useIssues();
  const options = [
    { label: '1 hour',    ms: 3600_000 },
    { label: 'Tomorrow',  ms: 86400_000 },
    { label: 'Next week', ms: 7 * 86400_000 },
  ];

  const handleSnooze = async (ms) => {
    if (item.kind === 'issue') {
      await snoozeIssue(item.rawId, new Date(Date.now() + ms).toISOString());
    }
    onClose();
  };

  return (
    <div className={styles.snoozeSheet}>
      <div className={styles.snoozeHeader}>Snooze until…</div>
      {options.map(o => (
        <button key={o.ms} className={styles.snoozeOption} onClick={() => handleSnooze(o.ms)}>
          {o.label}
        </button>
      ))}
      <button className={styles.snoozeCancel} onClick={onClose}>Cancel</button>
    </div>
  );
}

/* ─── Loading skeleton ─── */
function InboxSkeleton() {
  return (
    <div className={styles.skeletonList} style={{ opacity: 0.5 }}>
      {[0, 1, 2, 3].map(i => (
        <div key={i} className={styles.skeletonRow} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          Loading…
        </div>
      ))}
    </div>
  );
}

/* ─── Group items ─── */
function groupItems(items, mode) {
  if (mode === 'flat') return [{ key: 'all', label: null, items }];
  if (mode === 'urgency') {
    const order = ['critical', 'high', 'medium', 'low'];
    const labels = URGENCY;
    return order
      .map(k => ({ key: k, label: labels[k].label, items: items.filter(i => i.urgency === k) }))
      .filter(g => g.items.length);
  }
  if (mode === 'source') {
    const groups = {};
    items.forEach(i => { (groups[i.sourceModule] = groups[i.sourceModule] || []).push(i); });
    return Object.entries(groups).map(([k, v]) => ({ key: k, label: k, items: v }));
  }
  return [{ key: 'all', label: null, items }];
}

/* ─── Main Inbox component ─── */
const DEFAULT_LIMIT = 7;

export default function Inbox({ items = [], grouping = 'urgency', showHeader = true, title = 'Omni Inbox' }) {
  const { resolveIssue } = useIssues();
  const maintenanceCtx = useMaintenanceSafe();
  const projectCtx = useProjectsSafe();
  const issueCtx = useIssuesSafe();
  const [snoozeTarget, setSnoozeTarget] = useState(null);
  const [showAll, setShowAll] = useState(false);

  /* BUG #295: show skeleton while contexts are still loading to avoid misleading "Inbox zero" */
  const isLoading =
    issueCtx?.loading === true ||
    maintenanceCtx?.loading === true ||
    projectCtx?.loading === true;

  const visibleItems = showAll ? items : items.slice(0, DEFAULT_LIMIT);
  const groups = groupItems(visibleItems, grouping);
  const hiddenCount = Math.max(0, items.length - DEFAULT_LIMIT);

  const handleDone = async (item) => {
    if (item.kind === 'issue') {
      await resolveIssue(item.rawId);
    }
  };

  return (
    <div className={`card ${styles.inbox}`}>
      {showHeader && (
        <div className={styles.inboxHeader}>
          <span className={styles.inboxTitle}>{title}</span>
          {items.length > 0 && (
            <span className="pill pill-accent">{items.length} open</span>
          )}
          <div style={{ flex: 1 }} />
          {/* #163: Filter and New buttons removed — no onClick wired; dead UI. Reinstate when implemented. */}
        </div>
      )}

      {isLoading ? (
        <InboxSkeleton />
      ) : items.length === 0 ? (
        <EmptyState icon={Check} title="Inbox zero." description="Nothing needs your attention right now." />
      ) : (
        <>
          {groups.map(g => (
            <div key={g.key}>
              <GroupHeading label={g.label} count={g.items.length} />
              {g.items.map(item => (
                <InboxRowItem
                  key={item.id}
                  item={item}
                  onSnooze={setSnoozeTarget}
                  onDone={handleDone}
                />
              ))}
            </div>
          ))}

          {!showAll && hiddenCount > 0 && (
            <button className={styles.showMore} onClick={() => setShowAll(true)}>
              <ChevronRight size={14} />
              Show {hiddenCount} more
            </button>
          )}
        </>
      )}

      {/* Snooze overlay */}
      {snoozeTarget && (
        <div className={styles.snoozeOverlay} onClick={() => setSnoozeTarget(null)}>
          <div onClick={e => e.stopPropagation()}>
            <SnoozeSheet item={snoozeTarget} onClose={() => setSnoozeTarget(null)} />
          </div>
        </div>
      )}
    </div>
  );
}

/* Safe hooks — return null if context not mounted (provider may be absent on non-home routes) */
function useIssuesSafe() {
  try { return useIssues(); } catch { return null; }
}
function useMaintenanceSafe() {
  try { return useMaintenance(); } catch { return null; }
}
function useProjectsSafe() {
  try { return useProjects(); } catch { return null; }
}
