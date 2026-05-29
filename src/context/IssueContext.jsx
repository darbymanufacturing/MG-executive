import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import {
  collection, query, orderBy, onSnapshot, addDoc, updateDoc,
  doc, serverTimestamp, arrayUnion,
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';
import { useAuth } from './AuthContext.jsx';

const IssueContext = createContext(null);

const COLLECTION = 'issues';

export function IssueProvider({ children }) {
  const { user } = useAuth();
  const [issues,        setIssues]        = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [snapshotError, setSnapshotError] = useState(null);

  useEffect(() => {
    // BUG #220 — guard: do not start listener before auth resolves
    if (!user) {
      setIssues([]);
      setLoading(true);
      return;
    }
    const q = query(collection(db, COLLECTION), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setIssues(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error('[IssueContext] snapshot error:', err);
        setSnapshotError(err.message);
      },
    );
    return unsub;
  }, [user]);

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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    // #214: safeWrite wraps addDoc and returns { data: DocumentReference }.
    // Return the constructed payload + the new doc id, not the raw DocumentReference.
    const result = await safeWrite(
      () => addDoc(collection(db, COLLECTION), issueData),
      { rethrow: true, errorMessage: 'Failed to create issue' },
    );
    return { ...issueData, id: result.data?.id };
  }

  async function updateIssue(id, fields) {
    const result = await safeWrite(
      () => updateDoc(doc(db, COLLECTION, id), {
        ...fields,
        updatedAt: serverTimestamp(),
      }),
      { rethrow: true, errorMessage: 'Failed to update issue' },
    );
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
    const result = await safeWrite(
      () => updateDoc(doc(db, COLLECTION, id), {
        notes: arrayUnion({ text, authorUid: user.uid, at: new Date().toISOString() }),
        updatedAt: serverTimestamp(),
      }),
      { rethrow: true, errorMessage: 'Failed to add note' },
    );
    return result.data;
  }

  /* Active issues: not done, and not snoozed (unless snoozeUntil has passed) */
  const activeIssues = issues.filter((i) =>
    i.status !== 'done' &&
    !(i.status === 'snoozed' && i.snoozeUntil && i.snoozeUntil > new Date().toISOString())
  );

  // BUG #301 — memoize the context value to prevent unnecessary Firestore reconnects
  const value = useMemo(() => ({
    issues, activeIssues, loading, snapshotError,
    createIssue, updateIssue, snoozeIssue, resolveIssue, addNote,
  }), [issues, activeIssues, loading, snapshotError,
      createIssue, updateIssue, snoozeIssue, resolveIssue, addNote]);

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
