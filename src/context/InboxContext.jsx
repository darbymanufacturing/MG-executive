/**
 * InboxContext — selector context. No Firestore of its own.
 * Aggregates needs-attention items from all module contexts into
 * a normalized `inboxItems[]` array the UI reads from one place.
 *
 * Item shape: { id, kind, title, age, ageHours, urgency, nextAction, link, sourceModule, sourceIcon, owner? }
 */
import { createContext, useContext, useMemo } from 'react';
import { useIssues } from './IssueContext.jsx';
import { useMaintenance } from './MaintenanceContext.jsx';
import { useProjects } from './ProjectContext.jsx';

const InboxContext = createContext(null);

/* ─── Urgency scoring ─── */
const URGENCY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function computeAgeHours(ts) {
  if (!ts) return 0;
  const date = ts?.toDate ? ts.toDate() : new Date(ts);
  return Math.floor((Date.now() - date.getTime()) / 36e5);
}

function humanAge(hours) {
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h old`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '1 day old';
  return `${days} days old`;
}

function scoreUrgency(item) {
  /* Escalate urgency based on age */
  const base = URGENCY_ORDER[item.urgency] ?? 2;
  const agePenalty = item.ageHours > 120 ? -1 : item.ageHours > 48 ? -0.5 : 0;
  return Math.max(0, base + agePenalty);
}

function normalizeIssue(issue) {
  const ageHours = computeAgeHours(issue.createdAt);
  return {
    id: `issue_${issue.id}`,
    rawId: issue.id,
    kind: 'issue',
    title: issue.title || 'Untitled issue',
    ageHours,
    age: humanAge(ageHours),
    urgency: issue.urgency || 'medium',
    nextAction: issue.nextAction || 'Open and add next action',
    link: `/issues/${issue.id}`,
    sourceModule: 'Issues',
    source: issue.type ? issue.type.charAt(0).toUpperCase() + issue.type.slice(1) : 'Issue',
    sourceIcon: 'Flag',
    owner: issue.owner ? { uid: issue.owner } : null,
    status: issue.status,
    snoozeUntil: issue.snoozeUntil,
  };
}

function normalizeTicket(ticket) {
  const docId = ticket._docId || ticket.id || '';
  const ageHours = computeAgeHours(ticket.dateEntered || ticket.createdAt);
  const daysOpen = Math.floor(ageHours / 24);
  let urgency = 'low';
  if (daysOpen >= 14) urgency = 'critical';
  else if (daysOpen >= 7) urgency = 'high';
  else if (daysOpen >= 3) urgency = 'medium';

  return {
    id: `ticket_${docId}`,
    rawId: docId,
    kind: 'ticket',
    title: ticket.issueDescription || `Ticket #${docId.slice(-4)}`,
    ageHours,
    age: humanAge(ageHours),
    urgency,
    nextAction: ticket.status === 'Backlog' ? 'Assign to crew member' : 'Review and advance status',
    link: `/maintenance`,
    sourceModule: 'Tickets',
    source: 'Ticket',
    sourceIcon: 'Wrench',
    owner: null,
    status: ticket.status,
  };
}

function normalizeProject(project) {
  const docId = project._docId || project.id || '';
  const ageHours = computeAgeHours(project.updatedAt || project.createdAt);
  const hasBlockers = project.blockers?.some(b => !b.resolved) ?? false;
  const urgency = hasBlockers ? 'high' : ageHours > 168 ? 'medium' : 'low';

  return {
    id: `project_${docId}`,
    rawId: docId,
    kind: 'project',
    title: `${project.name || 'Project'} needs attention`,
    ageHours,
    age: humanAge(ageHours),
    urgency,
    nextAction: hasBlockers
      ? `Resolve blocker: ${project.blockers?.find(b => !b.resolved)?.text?.slice(0, 60) || 'view project'}`
      : 'Review project status',
    link: `/projects/${docId}`,
    sourceModule: 'Projects',
    source: 'Project',
    sourceIcon: 'Folder',
    owner: null,
    status: 'in-progress',
  };
}

export function InboxProvider({ children }) {
  /* Safely pull from contexts — some may not be mounted */
  const issueCtx = useIssuesSafe();
  const maintenanceCtx = useMaintenanceSafe();
  const projectCtx = useProjectsSafe();

  const inboxItems = useMemo(() => {
    const items = [];

    /* Issues */
    if (issueCtx?.activeIssues) {
      issueCtx.activeIssues.forEach(issue => {
        if (issue.status !== 'done' && issue.status !== 'snoozed') {
          items.push(normalizeIssue(issue));
        }
      });
    }

    /* Stale / blocked tickets (only surface the ones needing attention) */
    if (maintenanceCtx?.tickets) {
      maintenanceCtx.tickets
        .filter(t => ['Active', 'Backlog', 'Blocked'].includes(t.status))
        .filter(t => {
          const ageHours = computeAgeHours(t.dateEntered || t.createdAt);
          return ageHours > 48; /* only surface tickets stale > 2 days */
        })
        .slice(0, 5) /* cap at 5 so inbox isn't overwhelmed */
        .forEach(ticket => items.push(normalizeTicket(ticket)));
    }

    /* Projects needing attention */
    if (projectCtx?.projects) {
      projectCtx.projects
        .filter(p => {
          const ageHours = computeAgeHours(p.updatedAt || p.createdAt);
          const hasBlockers = p.blockers?.some(b => !b.resolved) ?? false;
          return hasBlockers || ageHours > 168; /* blockers or stale > 7d */
        })
        .slice(0, 3)
        .forEach(project => items.push(normalizeProject(project)));
    }

    /* Sort: urgency first, then age */
    return items.sort((a, b) => {
      const uDiff = scoreUrgency(a) - scoreUrgency(b);
      if (uDiff !== 0) return uDiff;
      return b.ageHours - a.ageHours;
    });
  }, [issueCtx?.activeIssues, maintenanceCtx?.tickets, projectCtx?.projects]);

  const value = useMemo(() => ({ inboxItems }), [inboxItems]);

  return (
    <InboxContext.Provider value={value}>
      {children}
    </InboxContext.Provider>
  );
}

export function useInbox() {
  const ctx = useContext(InboxContext);
  if (!ctx) throw new Error('useInbox must be used inside InboxProvider');
  return ctx;
}

/* Safe hooks — don't throw if context not mounted (provider may be absent) */
function useIssuesSafe() {
  try {
    return useIssues();
  } catch {
    return null;
  }
}
function useMaintenanceSafe() {
  try {
    return useMaintenance();
  } catch {
    return null;
  }
}
function useProjectsSafe() {
  try {
    return useProjects();
  } catch {
    return null;
  }
}
