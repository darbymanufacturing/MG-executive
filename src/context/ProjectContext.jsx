import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  collection, doc, onSnapshot,
  addDoc, updateDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';

const PROJECTS_COL = 'projects';
const GATES_COL    = 'decisionGates';

const ProjectContext = createContext(null);

export function ProjectProvider({ children }) {
  const [projects, setProjects]   = useState([]);
  const [gates, setGates]         = useState([]);
  const [loading, setLoading]     = useState(true);

  // ── Real-time listeners ───────────────────────────────────────────────────
  useEffect(() => {
    let projectsDone = false;
    let gatesDone    = false;

    const checkDone = () => {
      if (projectsDone && gatesDone) setLoading(false);
    };

    const unsubProjects = onSnapshot(collection(db, PROJECTS_COL), (snap) => {
      setProjects(snap.docs.map((d) => ({ _docId: d.id, ...d.data() })));
      projectsDone = true;
      checkDone();
    });

    const unsubGates = onSnapshot(collection(db, GATES_COL), (snap) => {
      setGates(snap.docs.map((d) => ({ _docId: d.id, ...d.data() })));
      gatesDone = true;
      checkDone();
    });

    return () => { unsubProjects(); unsubGates(); };
  }, []);

  // ── Project CRUD ──────────────────────────────────────────────────────────
  const addProject = useCallback(async (data) => {
    await addDoc(collection(db, PROJECTS_COL), {
      ...data,
      milestones: data.milestones || [],
      blockers:   data.blockers   || [],
      updates:    data.updates    || [],
      archived:   false,
      createdAt:  serverTimestamp(),
      updatedAt:  serverTimestamp(),
    });
  }, []);

  const updateProject = useCallback(async (docId, changes) => {
    await updateDoc(doc(db, PROJECTS_COL, docId), {
      ...changes,
      updatedAt: serverTimestamp(),
    });
  }, []);

  const deleteProject = useCallback(async (docId) => {
    await deleteDoc(doc(db, PROJECTS_COL, docId));
  }, []);

  const archiveProject = useCallback(async (docId) => {
    await updateDoc(doc(db, PROJECTS_COL, docId), {
      archived:  true,
      updatedAt: serverTimestamp(),
    });
  }, []);

  // ── Milestone helpers ─────────────────────────────────────────────────────
  const toggleMilestone = useCallback(async (docId, milestoneId) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const updated = project.milestones.map((m) =>
      m.id === milestoneId ? { ...m, done: !m.done } : m,
    );
    await updateDoc(doc(db, PROJECTS_COL, docId), {
      milestones: updated,
      updatedAt:  serverTimestamp(),
    });
  }, [projects]);

  const addMilestone = useCallback(async (docId, milestone) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const milestones = [...(project.milestones || []), {
      id:      crypto.randomUUID(),
      title:   milestone.title,
      dueDate: milestone.dueDate || '',
      done:    false,
    }];
    await updateDoc(doc(db, PROJECTS_COL, docId), { milestones, updatedAt: serverTimestamp() });
  }, [projects]);

  const deleteMilestone = useCallback(async (docId, milestoneId) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const milestones = project.milestones.filter((m) => m.id !== milestoneId);
    await updateDoc(doc(db, PROJECTS_COL, docId), { milestones, updatedAt: serverTimestamp() });
  }, [projects]);

  // ── Blocker helpers ───────────────────────────────────────────────────────
  const addBlocker = useCallback(async (docId, text) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const blockers = [...(project.blockers || []), {
      id:       crypto.randomUUID(),
      text,
      resolved: false,
    }];
    await updateDoc(doc(db, PROJECTS_COL, docId), { blockers, updatedAt: serverTimestamp() });
  }, [projects]);

  const toggleBlocker = useCallback(async (docId, blockerId) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const blockers = project.blockers.map((b) =>
      b.id === blockerId ? { ...b, resolved: !b.resolved } : b,
    );
    await updateDoc(doc(db, PROJECTS_COL, docId), { blockers, updatedAt: serverTimestamp() });
  }, [projects]);

  const deleteBlocker = useCallback(async (docId, blockerId) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const blockers = project.blockers.filter((b) => b.id !== blockerId);
    await updateDoc(doc(db, PROJECTS_COL, docId), { blockers, updatedAt: serverTimestamp() });
  }, [projects]);

  // ── Weekly update log ─────────────────────────────────────────────────────
  const addUpdate = useCallback(async (docId, text) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const updates = [
      { id: crypto.randomUUID(), date: new Date().toISOString().slice(0, 10), text },
      ...(project.updates || []),
    ];
    await updateDoc(doc(db, PROJECTS_COL, docId), { updates, updatedAt: serverTimestamp() });
  }, [projects]);

  // ── Decision Gates CRUD ───────────────────────────────────────────────────
  const addGate = useCallback(async (data) => {
    await addDoc(collection(db, GATES_COL), {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }, []);

  const updateGate = useCallback(async (docId, changes) => {
    await updateDoc(doc(db, GATES_COL, docId), {
      ...changes,
      updatedAt: serverTimestamp(),
    });
  }, []);

  const deleteGate = useCallback(async (docId) => {
    await deleteDoc(doc(db, GATES_COL, docId));
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────
  const activeProjects  = projects.filter((p) => !p.archived);
  const archivedProjects = projects.filter((p) => p.archived);

  return (
    <ProjectContext.Provider value={{
      projects, activeProjects, archivedProjects,
      gates, loading,
      addProject, updateProject, deleteProject, archiveProject,
      toggleMilestone, addMilestone, deleteMilestone,
      addBlocker, toggleBlocker, deleteBlocker,
      addUpdate,
      addGate, updateGate, deleteGate,
    }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjects() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProjects must be inside <ProjectProvider>');
  return ctx;
}
