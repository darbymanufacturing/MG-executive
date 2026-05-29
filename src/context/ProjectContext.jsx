import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import {
  collection, doc, onSnapshot, query, limit,
  addDoc, updateDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';

const PROJECTS_COL   = 'projects';
const GATES_COL      = 'decisionGates';
const BRAINSTORM_COL = 'brainstormIdeas';

// Phase 1.6b — safety caps on listener reads. These collections stay small;
// the limit just prevents runaway reads if they ever grow. Client-side sort
// is preserved (no orderBy added, to avoid excluding docs missing createdAt).
const MAX_PROJECTS   = 500;
const MAX_GATES      = 500;
const MAX_BRAINSTORM = 1000;

const ProjectContext = createContext(null);

/** Compute effective status: if any unresolved external blocker exists → 'blocked' */
function effectiveStatus(project) {
  const hasExternalBlocker = (project.blockers || []).some(
    (b) => !b.resolved && b.type === 'external',
  );
  return hasExternalBlocker ? 'blocked' : (project.status || 'onTrack');
}

/** Patch a project doc with safeWrite + auto-updatedAt. Re-throws after toasting. */
function patchProject(docId, changes, errorMessage) {
  return safeWrite(
    () => updateDoc(doc(db, PROJECTS_COL, docId), { ...changes, updatedAt: serverTimestamp() }),
    { rethrow: true, errorMessage },
  );
}

export function ProjectProvider({ children }) {
  const [projects, setProjects]               = useState([]);
  const [gates, setGates]                     = useState([]);
  const [brainstormIdeas, setBrainstormIdeas]  = useState([]);
  const [loading, setLoading]                 = useState(true);
  const [snapshotError, setSnapshotError]     = useState(null);

  // ── Real-time listeners ───────────────────────────────────────────────────
  useEffect(() => {
    let projectsDone   = false;
    let gatesDone      = false;
    let brainstormDone = false;

    const checkDone = () => {
      if (projectsDone && gatesDone && brainstormDone) setLoading(false);
    };

    const unsubProjects = onSnapshot(
      query(collection(db, PROJECTS_COL), limit(MAX_PROJECTS)),
      (snap) => {
        const raw = snap.docs.map((d) => ({ _docId: d.id, ...d.data() }));
        const sorted = raw.sort((a, b) =>
          (b.createdAt || '') > (a.createdAt || '') ? 1 : -1
        );
        setProjects(sorted.map((p) => ({ ...p, effectiveStatus: effectiveStatus(p) })));
        projectsDone = true;
        checkDone();
      },
      (err) => {
        console.error('[ProjectContext] projects snapshot error:', err);
        setSnapshotError(err.message);
      },
    );

    const unsubGates = onSnapshot(
      query(collection(db, GATES_COL), limit(MAX_GATES)),
      (snap) => {
        setGates(snap.docs.map((d) => ({ _docId: d.id, ...d.data() })));
        gatesDone = true;
        checkDone();
      },
      (err) => {
        console.error('[ProjectContext] gates snapshot error:', err);
        setSnapshotError(err.message);
      },
    );

    const unsubBrainstorm = onSnapshot(
      query(collection(db, BRAINSTORM_COL), limit(MAX_BRAINSTORM)),
      (snap) => {
        const ideas = snap.docs
          .map((d) => ({ _docId: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        setBrainstormIdeas(ideas);
        brainstormDone = true;
        checkDone();
      },
      (err) => {
        console.error('[ProjectContext] brainstorm snapshot error:', err);
        setSnapshotError(err.message);
      },
    );

    return () => { unsubProjects(); unsubGates(); unsubBrainstorm(); };
  }, []);

  // ── Project CRUD ──────────────────────────────────────────────────────────
  const addProject = useCallback(async (data) => {
    await safeWrite(
      () => addDoc(collection(db, PROJECTS_COL), {
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
      }),
      { rethrow: true, errorMessage: 'Failed to create project' },
    );
  }, []);

  const updateProject = useCallback(async (docId, changes) =>
    patchProject(docId, changes, 'Failed to update project'),
  []);

  const deleteProject = useCallback(async (docId) => {
    await safeWrite(
      () => deleteDoc(doc(db, PROJECTS_COL, docId)),
      { rethrow: true, errorMessage: 'Failed to delete project' },
    );
  }, []);

  const archiveProject = useCallback(async (docId) =>
    patchProject(docId, { archived: true }, 'Failed to archive project'),
  []);

  const unarchiveProject = useCallback(async (docId) =>
    patchProject(docId, { archived: false }, 'Failed to unarchive project'),
  []);

  // ── Status ────────────────────────────────────────────────────────────────
  const setStatus = useCallback(async (docId, status) =>
    patchProject(docId, { status }, 'Failed to set project status'),
  []);

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
        duration:     phase.duration || null,
        dependencies: phase.dependencies || [],
      },
    ];
    await patchProject(docId, { phases }, 'Failed to add phase');
  }, [projects]);

  const updatePhase = useCallback(async (docId, phaseId, changes) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const phases = (project.phases || []).map((ph) =>
      ph.id === phaseId ? { ...ph, ...changes } : ph,
    );
    await patchProject(docId, { phases }, 'Failed to update phase');
  }, [projects]);

  const deletePhase = useCallback(async (docId, phaseId) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const phases = (project.phases || [])
      .filter((ph) => ph.id !== phaseId)
      .map((ph, i) => ({ ...ph, number: i + 1 }));
    await patchProject(docId, { phases }, 'Failed to delete phase');
  }, [projects]);

  const reorderPhases = useCallback(async (docId, fromIndex, toIndex) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const phases = [...(project.phases || [])];
    const [moved] = phases.splice(fromIndex, 1);
    phases.splice(toIndex, 0, moved);
    const renumbered = phases.map((ph, i) => ({ ...ph, number: i + 1 }));
    await patchProject(docId, { phases: renumbered }, 'Failed to reorder phases');
  }, [projects]);

  // ── Next Action helpers ───────────────────────────────────────────────────
  const setNextAction = useCallback(async (docId, nextAction) =>
    patchProject(
      docId,
      { nextAction: { ...nextAction, updatedAt: new Date().toISOString() } },
      'Failed to set next action',
    ),
  []);

  /** Complete current next action, auto-log it to updates[], clear nextAction. */
  const completeNextAction = useCallback(async (docId) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project?.nextAction) return;
    const completedEntry = {
      id:   crypto.randomUUID(),
      date: new Date().toISOString().slice(0, 10),
      text: `✓ Completed next action: "${project.nextAction.text}"`,
    };
    const updates = [completedEntry, ...(project.updates || [])];
    await patchProject(docId, { nextAction: null, updates }, 'Failed to complete next action');
  }, [projects]);

  // ── Blocker helpers ───────────────────────────────────────────────────────
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
    const statusUpdate = type === 'external' ? { status: 'blocked' } : {};
    await patchProject(docId, { blockers, ...statusUpdate }, 'Failed to add blocker');
  }, [projects]);

  const resolveBlocker = useCallback(async (docId, blockerId) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const blockers = (project.blockers || []).map((b) =>
      b.id === blockerId
        ? { ...b, resolved: true, resolvedAt: new Date().toISOString().slice(0, 10) }
        : b,
    );
    await patchProject(docId, { blockers }, 'Failed to resolve blocker');
  }, [projects]);

  const deleteBlocker = useCallback(async (docId, blockerId) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const blockers = (project.blockers || []).filter((b) => b.id !== blockerId);
    await patchProject(docId, { blockers }, 'Failed to delete blocker');
  }, [projects]);

  // Kept for War Room backward compat
  const toggleBlocker = useCallback(async (docId, blockerId) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const blockers = (project.blockers || []).map((b) =>
      b.id === blockerId ? { ...b, resolved: !b.resolved } : b,
    );
    await patchProject(docId, { blockers }, 'Failed to toggle blocker');
  }, [projects]);

  // ── Activity log (updates[]) ──────────────────────────────────────────────
  const addUpdate = useCallback(async (docId, text) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const updates = [
      { id: crypto.randomUUID(), date: new Date().toISOString().slice(0, 10), text },
      ...(project.updates || []),
    ];
    await patchProject(docId, { updates }, 'Failed to add update');
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
    await patchProject(docId, { decisions }, 'Failed to add decision');
  }, [projects]);

  // ── POW Entries (append-only) ─────────────────────────────────────────────
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
    await patchProject(docId, { powEntries }, 'Failed to add POW entry');
  }, [projects]);

  // ── Brainstorm Ideas (global) ─────────────────────────────────────────────
  const addBrainstormIdea = useCallback(async ({ text, tag = '' }) => {
    await safeWrite(
      () => addDoc(collection(db, BRAINSTORM_COL), {
        text,
        tag,
        createdAt: new Date().toISOString(),
      }),
      { rethrow: true, errorMessage: 'Failed to add brainstorm idea' },
    );
  }, []);

  const deleteBrainstormIdea = useCallback(async (docId) => {
    await safeWrite(
      () => deleteDoc(doc(db, BRAINSTORM_COL, docId)),
      { rethrow: true, errorMessage: 'Failed to delete brainstorm idea' },
    );
  }, []);

  const updateBrainstormIdea = useCallback(async (docId, changes) => {
    await safeWrite(
      () => updateDoc(doc(db, BRAINSTORM_COL, docId), changes),
      { rethrow: true, errorMessage: 'Failed to update brainstorm idea' },
    );
  }, []);

  // ── Milestone helpers (kept for War Room backward compat) ────────────────
  const toggleMilestone = useCallback(async (docId, milestoneId) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const milestones = (project.milestones || []).map((m) =>
      m.id === milestoneId ? { ...m, done: !m.done } : m,
    );
    await patchProject(docId, { milestones }, 'Failed to toggle milestone');
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
    await patchProject(docId, { milestones }, 'Failed to add milestone');
  }, [projects]);

  const deleteMilestone = useCallback(async (docId, milestoneId) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const milestones = (project.milestones || []).filter((m) => m.id !== milestoneId);
    await patchProject(docId, { milestones }, 'Failed to delete milestone');
  }, [projects]);

  const updateMilestone = useCallback(async (docId, milestoneId, changes) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return;
    const milestones = (project.milestones || []).map((m) =>
      m.id === milestoneId ? { ...m, ...changes } : m,
    );
    await patchProject(docId, { milestones }, 'Failed to update milestone');
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
    await patchProject(docId, { phases }, 'Failed to set task assignee');
  }, [projects]);

  // ── Project interconnection ───────────────────────────────────────────────
  const promotePhaseToProject = useCallback(async (docId, phaseId) => {
    const project = projects.find((p) => p._docId === docId);
    if (!project) return null;
    const phase = (project.phases || []).find((ph) => ph.id === phaseId);
    if (!phase) return null;

    const addResult = await safeWrite(
      () => addDoc(collection(db, PROJECTS_COL), {
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
      }),
      { rethrow: true, errorMessage: 'Failed to promote phase to project' },
    );
    const newProjectRef = addResult.data;

    // Write childProjectId back onto the source phase + link parent → new
    const phases = (project.phases || []).map((ph) =>
      ph.id === phaseId ? { ...ph, childProjectId: newProjectRef.id } : ph,
    );
    const parentLinked = [...(project.linkedProjectIds || []), newProjectRef.id];
    await patchProject(
      docId,
      { phases, linkedProjectIds: parentLinked },
      'Phase promoted but failed to link back to parent project',
    );

    return newProjectRef.id;
  }, [projects]);

  const linkProjects = useCallback(async (aId, bId) => {
    const a = projects.find((p) => p._docId === aId);
    const b = projects.find((p) => p._docId === bId);
    if (!a || !b) return;
    if (!(a.linkedProjectIds || []).includes(bId)) {
      await patchProject(
        aId,
        { linkedProjectIds: [...(a.linkedProjectIds || []), bId] },
        'Failed to link projects',
      );
    }
    if (!(b.linkedProjectIds || []).includes(aId)) {
      await patchProject(
        bId,
        { linkedProjectIds: [...(b.linkedProjectIds || []), aId] },
        'Failed to link projects',
      );
    }
  }, [projects]);

  const unlinkProjects = useCallback(async (aId, bId) => {
    const a = projects.find((p) => p._docId === aId);
    const b = projects.find((p) => p._docId === bId);
    if (a) {
      await patchProject(
        aId,
        { linkedProjectIds: (a.linkedProjectIds || []).filter((id) => id !== bId) },
        'Failed to unlink projects',
      );
    }
    if (b) {
      await patchProject(
        bId,
        { linkedProjectIds: (b.linkedProjectIds || []).filter((id) => id !== aId) },
        'Failed to unlink projects',
      );
    }
  }, [projects]);

  // ── Decision Gates CRUD ───────────────────────────────────────────────────
  const addGate = useCallback(async (data) => {
    await safeWrite(
      () => addDoc(collection(db, GATES_COL), {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
      { rethrow: true, errorMessage: 'Failed to add decision gate' },
    );
  }, []);

  const updateGate = useCallback(async (docId, changes) => {
    await safeWrite(
      () => updateDoc(doc(db, GATES_COL, docId), {
        ...changes,
        updatedAt: serverTimestamp(),
      }),
      { rethrow: true, errorMessage: 'Failed to update decision gate' },
    );
  }, []);

  const deleteGate = useCallback(async (docId) => {
    await safeWrite(
      () => deleteDoc(doc(db, GATES_COL, docId)),
      { rethrow: true, errorMessage: 'Failed to delete decision gate' },
    );
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────
  const activeProjects   = projects.filter((p) => !p.archived);
  const archivedProjects = projects.filter((p) => p.archived);

  // BUG #301 — memoize the context value to prevent unnecessary Firestore reconnects
  const value = useMemo(() => ({
    projects, activeProjects, archivedProjects,
    gates, brainstormIdeas, loading, snapshotError,
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
  }), [
    projects, activeProjects, archivedProjects,
    gates, brainstormIdeas, loading, snapshotError,
    addProject, updateProject, deleteProject, archiveProject, unarchiveProject,
    setStatus,
    addPhase, updatePhase, deletePhase, reorderPhases,
    setNextAction, completeNextAction,
    addBlocker, resolveBlocker, deleteBlocker, toggleBlocker,
    addUpdate,
    addDecision,
    addPowEntry,
    addBrainstormIdea, deleteBrainstormIdea, updateBrainstormIdea,
    setTaskAssignee,
    promotePhaseToProject, linkProjects, unlinkProjects,
    toggleMilestone, addMilestone, deleteMilestone, updateMilestone,
    addGate, updateGate, deleteGate,
  ]);

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProjects() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProjects must be inside <ProjectProvider>');
  return ctx;
}
