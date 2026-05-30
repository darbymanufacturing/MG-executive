import { createContext, useContext, useMemo } from 'react';
import { arrayUnion } from 'firebase/firestore';
import { useOrgCollection } from '../hooks/useOrgCollection.js';
import { orgWrite, orgUpdate } from '../hooks/orgWrite.js';
import { useAuth } from './AuthContext.jsx';

const IssueContext = createContext(null);

const COLLECTION = 'issues';

export function IssueProvider({ children }) {
  const { user } = useAuth();

  // Phase 2 (ADR-0003): org-scoped read. The pre-Phase-2 `if (!user)` listener
  // guard is now handled inside useOrgCollection (it returns loading while the org
  // resolves, and the org only resolves for a signed-in user).
  const { items, loading, error } = useOrgCollection(COLLECTION, {
    orderBy: ['createdAt', 'desc'],
    limit: 1000,
  });

  // Preserve the public shape: consumers read `.id` (was the Firestore doc id).
  const issues = useMemo(
    () => items.map(({ _docId, ...rest }) => ({ id: _docId, ...rest })),
    [items],
  );

  async function createIssue(fields) {
    if (!user) throw new Error('Not authenticated');
    const issueData = {
      title: '',
      description: '',
      type: 'other',
      status: 'new',
      urgency: 'medium',
      owner: user.uid,
      createdBy: user.uid,
      visibility: 'admin',
      attachments: [],
      notes: [],
      nextAction: '',
      relatedEntity: null,
      dueDate: null,
      snoozeUntil: null,
      ...fields,
    };
    // orgWrite stamps orgId + createdByUid + createdAt/updatedAt (serverTimestamp).
    const result = await orgWrite(COLLECTION, issueData, {
      rethrow: true, errorMessage: 'Failed to create issue',
    });
    return { ...issueData, id: result.data?.id };
  }

  async function updateIssue(id, fields) {
    const result = await orgUpdate(COLLECTION, id, fields, {
      rethrow: true, errorMessage: 'Failed to update issue',
    });
    return result.data;
  }

  async function snoozeIssue(id, until) {
    return updateIssue(id, { status: 'snoozed', snoozeUntil: until });
  }

  async function resolveIssue(id) {
    return updateIssue(id, { status: 'done' });
  }

  async function addNote(id, text) {
    if (!user) throw new Error('Not authenticated');
    const result = await orgUpdate(COLLECTION, id, {
      notes: arrayUnion({ text, authorUid: user.uid, at: new Date().toISOString() }),
    }, { rethrow: true, errorMessage: 'Failed to add note' });
    return result.data;
  }

  /* Active issues: not done, and not snoozed (unless snoozeUntil has passed) */
  const activeIssues = issues.filter((i) =>
    i.status !== 'done' &&
    !(i.status === 'snoozed' && i.snoozeUntil && i.snoozeUntil > new Date().toISOString())
  );

  // BUG #301 — memoize the context value to prevent unnecessary Firestore reconnects
  const value = useMemo(() => ({
    issues, activeIssues, loading, snapshotError: error ? error.message : null,
    createIssue, updateIssue, snoozeIssue, resolveIssue, addNote,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [issues, activeIssues, loading, error]);

  return (
    <IssueContext.Provider value={value}>
      {children}
    </IssueContext.Provider>
  );
}

export function useIssues() {
  const ctx = useContext(IssueContext);
  if (!ctx) throw new Error('useIssues must be used inside IssueProvider');
  return ctx;
}

export function useIssue(id) {
  const { issues } = useIssues();
  return issues.find(i => i.id === id) || null;
}
