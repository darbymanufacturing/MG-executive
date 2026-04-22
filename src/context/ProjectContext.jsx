import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  collection, doc, onSnapshot,
  addDoc, updateDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';

const PROJECTS_COL   = 'projects';
const GATES_COL      = 'decisionGates';
const BRAINSTORM_COL = 'brainstormIdeas';

const ProjectContext = createContext(null);

/** Compute effective status: if any unresolved external blocker exists → 'blocked' */
function effectiveStatus(project) {
  const hasExternalBlocker = (project.blockers || []).some(
    (b) => !b.resolved && b.type === 'external',
  );
  return hasExternalBlocker ? 'blocked' : (project.status || 'onTrack');
}

export function ProjectProvider({ children }) {
  const [projects, setProjects]             = useState([]);
  const [gates, setGates]                   = useState([]);
  const [brainstormIdeas, setBrainstormIdeas] = useState([]);
  const [loading, setLoading]               = useState(true);

  // ── Real-time listeners ───────────────────────────────────────────────────
  useEffect(() => {
    let projectsDone   = false;
    let gatesDone      = false;
    let brainstormDone = false;

    const checkDone = () => {
      if (projectsDone && gatesDone && brainstormDone) setLoading(false);
    };

    const unsubProjects = onSnapshot(collection(db, PROJECTS_COL), (snap) => {
      const raw = snap.docs.map((d) => ({ _docId: d.id, ...d.data() }));
      setProjects(raw.map((p) => ({ ...p, effectiveStatus: effectiveStatus(p) })));
      projectsDone = true;
      checkDone();
    });

    const unsubGates = onSnapshot(collection(db, GATES_COL), (snap) => {
      setGates(snap.docs.map((d) => ({ _docId: d.id, ...d.data() })));
      gatesDone = true;
      checkDone();
    });

    const unsubBrainstorm = onSnapshot(collection(db, BRAINSTORM_COL), (snap) => {
      const ideas = snap.docs
        .map((d) => ({ _docId: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setBrainstormIdeas(ideas);
      brainstormDone = true;
      checkDone();
    });

    return () => { unsubProjects(); unsubGates(); unsubBrainstorm(); };
  }, []);

  // ── Project CRUD ──────────────────────────────────────────────────────────
  const addProject = useCallback(async (data) => {
    await addDoc(collection(db, PROJECTS_COL), {
      ...data,
      phases:        data.phases        || [],
      blockers:      data.blockers      || [],
      updates:       data.updates       || [],
      decisions:     data.decisions     || [],
      powEntries:    data.powEntries    || [],
      linkedProjectIds: data.linkedProjectIds || [],
      archived:      false,
      createdAt:     serverTimestamp(),
      updatedAt:     serverTimestamp(),
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

  const unarchiveProject = useCallback(async (docId) => {
    await updateDoc(doc(db, PROJECTS_COL, docId), {
      archived:  false,
      updatedAt: serverTimestamp(),
    });
  }, []);

  // ── Status ────────────────────────────────────────────────────────────────
  const setStatus = useCallback(async (docId, status) => {
    await updateDoc(doc(db, PROJECTS_COL, docId), {
      status,
      updatedAt: serverTimestamp(),
    });
  }, []);

  // ── Phase helpers ─────────────────────────────────────────────────────────
  const addPhase = useCallback(async (docId, phase) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const phases = [
      ...(project.phases || []),
      {
        id:           crypto.randomUUID(),
        number:       (project.phases || []).length + 1,
        name:         phase.name || 'New Phase',
        doneCriteria: phase.doneCriteria || [],
        status:       'notStarted',
        targetDate:   phase.targetDate || null,
        actualDate:   null,
        scopeCap:     phase.scopeCap || '',
        parallel:     phase.parallel || false,
        tasks:        phase.tasks || [],
      },
    ];
    await updateDoc(doc(db, PROJECTS_COL, docId), { phases, updatedAt: serverTimestamp() });
  }, [projects]);

  const updatePhase = useCallback(async (docId, phaseId, changes) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const phases = (project.phases || []).map((ph) =>
      ph.id === phaseId ? { ...ph, ...changes } : ph,
    );
    await updateDoc(doc(db, PROJECTS_COL, docId), { phases, updatedAt: serverTimestamp() });
  }, [projects]);

  const deletePhase = useCallback(async (docId, phaseId) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const phases = (project.phases || [])
      .filter((ph) => ph.id !== phaseId)
      .map((ph, i) => ({ ...ph, number: i + 1 }));
    await updateDoc(doc(db, PROJECTS_COL, docId), { phases, updatedAt: serverTimestamp() });
  }, [projects]);

  const reorderPhases = useCallback(async (docId, fromIndex, toIndex) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const phases = [...(project.phases || [])];
    const [moved] = phases.splice(fromIndex, 1);
    phases.splice(toIndex, 0, moved);
    const renumbered = phases.map((ph, i) => ({ ...ph, number: i + 1 }));
    await updateDoc(doc(db, PROJECTS_COL, docId), { phases: renumbered, updatedAt: serverTimestamp() });
  }, [projects]);

  // ── Next Action helpers ───────────────────────────────────────────────────
  const setNextAction = useCallback(async (docId, nextAction) => {
    await updateDoc(doc(db, PROJECTS_COL, docId), {
      nextAction: { ...nextAction, updatedAt: new Date().toISOString() },
      updatedAt:  serverTimestamp(),
    });
  }, []);

  /**
   * Complete the current next action: auto-log it to the activity log,
   * then clear nextAction so the UI can prompt for the next one.
   */
  const completeNextAction = useCallback(async (docId) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project?.nextAction) return;
    const completedEntry = {
      id:   crypto.randomUUID(),
      date: new Date().toISOString().slice(0, 10),
      text: `✓ Completed next action: "${project.nextAction.text}"`,
    };
    const updates = [completedEntry, ...(project.updates || [])];
    await updateDoc(doc(db, PROJECTS_COL, docId), {
      nextAction: null,
      updates,
      updatedAt:  serverTimestamp(),
    });
  }, [projects]);

  // ── Blocker helpers (extended with type + escalation) ─────────────────────
  const addBlocker = useCallback(async (docId, { text, type = 'internal', escalation = '' }) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const blocker = {
      id:         crypto.randomUUID(),
      text,
      type,
      escalation,
      resolved:   false,
      addedAt:    new Date().toISOString().slice(0, 10),
      resolvedAt: null,
    };
    const blockers = [...(project.blockers || []), blocker];
    // Auto-set project status to blocked if external
    const statusUpdate = type === 'external' ? { status: 'blocked' } : {};
    await updateDoc(doc(db, PROJECTS_COL, docId), {
      blockers,
      ...statusUpdate,
      updatedAt: serverTimestamp(),
    });
  }, [projects]);

  const resolveBlocker = useCallback(async (docId, blockerId) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const blockers = (project.blockers || []).map((b) =>
      b.id === blockerId
        ? { ...b, resolved: true, resolvedAt: new Date().toISOString().slice(0, 10) }
        : b,
    );
    await updateDoc(doc(db, PROJECTS_COL, docId), { blockers, updatedAt: serverTimestamp() });
  }, [projects]);

  const deleteBlocker = useCallback(async (docId, blockerId) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const blockers = (project.blockers || []).filter((b) => b.id !== blockerId);
    await updateDoc(doc(db, PROJECTS_COL, docId), { blockers, updatedAt: serverTimestamp() });
  }, [projects]);

  // Kept for War Room backward compat
  const toggleBlocker = useCallback(async (docId, blockerId) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const blockers = (project.blockers || []).map((b) =>
      b.id === blockerId ? { ...b, resolved: !b.resolved } : b,
    );
    await updateDoc(doc(db, PROJECTS_COL, docId), { blockers, updatedAt: serverTimestamp() });
  }, [projects]);

  // ── Activity log (updates[]) ──────────────────────────────────────────────
  const addUpdate = useCallback(async (docId, text) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const updates = [
      { id: crypto.randomUUID(), date: new Date().toISOString().slice(0, 10), text },
      ...(project.updates || []),
    ];
    await updateDoc(doc(db, PROJECTS_COL, docId), { updates, updatedAt: serverTimestamp() });
  }, [projects]);

  // ── Decision Log ──────────────────────────────────────────────────────────
  const addDecision = useCallback(async (docId, decision) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const entry = {
      id:           crypto.randomUUID(),
      date:         new Date().toISOString().slice(0, 10),
      title:        decision.title || '',
      decision:     decision.decision || '',
      why:          decision.why || '',
      madeBy:       decision.madeBy || '',
      alternatives: decision.alternatives || '',
    };
    const decisions = [entry, ...(project.decisions || [])];
    await updateDoc(doc(db, PROJECTS_COL, docId), { decisions, updatedAt: serverTimestamp() });
  }, [projects]);

  // ── POW Entries (append-only — no edit/delete) ───────────────────────────
  const addPowEntry = useCallback(async (docId, entry) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const powEntry = {
      id:        crypto.randomUUID(),
      weekOf:    entry.weekOf,
      moved:     entry.moved || '',
      blocked:   entry.blocked || '',
      focusNext: entry.focusNext || '',
      status:    entry.status || 'onTrack',
      loggedBy:  entry.loggedBy || 'Kostas',
      loggedAt:  new Date().toISOString(),
    };
    const powEntries = [powEntry, ...(project.powEntries || [])];
    await updateDoc(doc(db, PROJECTS_COL, docId), { powEntries, updatedAt: serverTimestamp() });
  }, [projects]);

  // ── Brainstorm Ideas (global — standalone collection) ─────────────────────
  const addBrainstormIdea = useCallback(async ({ text, tag = '' }) => {
    await addDoc(collection(db, BRAINSTORM_COL), {
      text,
      tag,
      createdAt: new Date().toISOString(),
    });
  }, []);

  const deleteBrainstormIdea = useCallback(async (docId) => {
    await deleteDoc(doc(db, BRAINSTORM_COL, docId));
  }, []);

  const updateBrainstormIdea = useCallback(async (docId, changes) => {
    await updateDoc(doc(db, BRAINSTORM_COL, docId), changes);
  }, []);

  // ── Milestone helpers (kept for War Room backward compat) ────────────────
  const toggleMilestone = useCallback(async (docId, milestoneId) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const updated = (project.milestones || []).map((m) =>
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
    const milestones = (project.milestones || []).filter((m) => m.id !== milestoneId);
    await updateDoc(doc(db, PROJECTS_COL, docId), { milestones, updatedAt: serverTimestamp() });
  }, [projects]);

  const updateMilestone = useCallback(async (docId, milestoneId, changes) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const milestones = (project.milestones || []).map((m) =>
      m.id === milestoneId ? { ...m, ...changes } : m,
    );
    await updateDoc(doc(db, PROJECTS_COL, docId), { milestones, updatedAt: serverTimestamp() });
  }, [projects]);

  // ── Task assignee ─────────────────────────────────────────────────────────
  const setTaskAssignee = useCallback(async (docId, phaseId, taskId, assignee) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const phases = (project.phases || []).map((ph) => {
      if (ph.id !== phaseId) return ph;
      const tasks = (ph.tasks || []).map((t) =>
        t.id === taskId ? { ...t, assignee: assignee || null } : t,
      );
      return { ...ph, tasks };
    });
    await updateDoc(doc(db, PROJECTS_COL, docId), { phases, updatedAt: serverTimestamp() });
  }, [projects]);

  // ── Project interconnection ───────────────────────────────────────────────
  const promotePhaseToProject = useCallback(async (docId, phaseId) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return null;
    const phase = (project.phases || []).find((ph) => ph.id === phaseId);
    if (!phase) return null;

    const newProjectRef = await addDoc(collection(db, PROJECTS_COL), {
      name:             `${project.name} — ${phase.name}`,
      tagline:          `Promoted from phase ${phase.number} of "${project.name}"`,
      owner:            project.owner || 'Kostas',
      projectType:      project.projectType || '',
      category:         project.category || '',
      status:           'onTrack',
      startDate:        phase.targetDate || new Date().toISOString().slice(0, 10),
      targetDate:       phase.targetDate || null,
      parentProjectId:  docId,
      phases:           [],
      blockers:         [],
      updates:          [],
      decisions:        [],
      powEntries:       [],
      linkedProjectIds: [docId],
      archived:         false,
      createdAt:        serverTimestamp(),
      updatedAt:        serverTimestamp(),
    });

    // Write childProjectId back onto the source phase
    const phases = (project.phases || []).map((ph) =>
      ph.id === phaseId ? { ...ph, childProjectId: newProjectRef.id } : ph,
    );
    // Also add the new project to linkedProjectIds of the parent
    const parentLinked = [...(project.linkedProjectIds || []), newProjectRef.id];
    await updateDoc(doc(db, PROJECTS_COL, docId), {
      phases,
      linkedProjectIds: parentLinked,
      updatedAt: serverTimestamp(),
    });

    return newProjectRef.id;
  }, [projects]);

  const linkProjects = useCallback(async (aId, bId) => {
    const a = projects.find((p) => p._docId === aId);
    const b = projects.find((p) => p._docId === bId);
    if (!a || !b) return;
    if (!(a.linkedProjectIds || []).includes(bId)) {
      await updateDoc(doc(db, PROJECTS_COL, aId), {
        linkedProjectIds: [...(a.linkedProjectIds || []), bId],
        updatedAt: serverTimestamp(),
      });
    }
    if (!(b.linkedProjectIds || []).includes(aId)) {
      await updateDoc(doc(db, PROJECTS_COL, bId), {
        linkedProjectIds: [...(b.linkedProjectIds || []), aId],
        updatedAt: serverTimestamp(),
      });
    }
  }, [projects]);

  const unlinkProjects = useCallback(async (aId, bId) => {
    const a = projects.find((p) => p._docId === aId);
    const b = projects.find((p) => p._docId === bId);
    if (a) {
      await updateDoc(doc(db, PROJECTS_COL, aId), {
        linkedProjectIds: (a.linkedProjectIds || []).filter((id) => id !== bId),
        updatedAt: serverTimestamp(),
      });
    }
    if (b) {
      await updateDoc(doc(db, PROJECTS_COL, bId), {
        linkedProjectIds: (b.linkedProjectIds || []).filter((id) => id !== aId),
        updatedAt: serverTimestamp(),
      });
    }
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
  const activeProjects   = projects.filter((p) => !p.archived);
  const archivedProjects = projects.filter((p) => p.archived);

  return (
    <ProjectContext.Provider value={{
      projects, activeProjects, archivedProjects,
      gates, brainstormIdeas, loading,
      // Project CRUD
      addProject, updateProject, deleteProject, archiveProject, unarchiveProject,
      setStatus,
      // Phases
      addPhase, updatePhase, deletePhase, reorderPhases,
      // Next Action
      setNextAction, completeNextAction,
      // Blockers
      addBlocker, resolveBlocker, deleteBlocker, toggleBlocker,
      // Activity log
      addUpdate,
      // Decisions
      addDecision,
      // POW
      addPowEntry,
      // Brainstorm (global)
      addBrainstormIdea, deleteBrainstormIdea, updateBrainstormIdea,
      // Task assignee
      setTaskAssignee,
      // Interconnection
      promotePhaseToProject, linkProjects, unlinkProjects,
      // Milestones (War Room compat)
      toggleMilestone, addMilestone, deleteMilestone, updateMilestone,
      // Decision Gates (War Room compat)
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
