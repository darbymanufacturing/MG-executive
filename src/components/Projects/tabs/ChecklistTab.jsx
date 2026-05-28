import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, User, ChevronDown } from 'lucide-react';
import { useProjects } from '../../../context/ProjectContext.jsx';
import { flattenTasks, tasksByAssignee } from '../../../utils/projectAggregations.js';
import { ASSIGNEES } from '../constants.js';
import styles from './ChecklistTab.module.css';

const STATUS_OPTS = [
  { value: 'open',  label: 'Open' },
  { value: 'done',  label: 'Done' },
  { value: 'all',   label: 'All' },
];

function AssigneeSelect({ value, onChange }) {
  return (
    <select className={styles.inlineSelect} value={value || ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— unassigned —</option>
      {ASSIGNEES.map((a) => <option key={a} value={a}>{a}</option>)}
    </select>
  );
}

export default function ChecklistTab() {
  const navigate = useNavigate();
  const { activeProjects, updatePhase, setTaskAssignee } = useProjects();

  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [statusFilter,   setStatusFilter]   = useState('open');
  const [search,         setSearch]          = useState('');

  const allTasks = useMemo(() => flattenTasks(activeProjects), [activeProjects]);
  const counts   = useMemo(() => tasksByAssignee(activeProjects), [activeProjects]);

  const filtered = useMemo(() => {
    return allTasks.filter((t) => {
      if (assigneeFilter !== 'all') {
        const key = t.assignee || 'Unassigned';
        if (key !== assigneeFilter) return false;
      }
      if (statusFilter === 'open' && t.done)  return false;
      if (statusFilter === 'done' && !t.done) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(t.text ?? '').toLowerCase().includes(q) && !t.projectName.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [allTasks, assigneeFilter, statusFilter, search]);

  // Group by assignee (null → Unassigned) when showing all, else group by project
  const grouped = useMemo(() => {
    if (assigneeFilter !== 'all') {
      const byProject = {};
      for (const t of filtered) {
        const key = t.projectId;
        if (!byProject[key]) byProject[key] = { name: t.projectName, id: t.projectId, tasks: [] };
        byProject[key].tasks.push(t);
      }
      return Object.values(byProject).sort((a, b) => a.name.localeCompare(b.name));
    }
    // Group by assignee
    const byAssignee = {};
    for (const t of filtered) {
      const key = t.assignee || 'Unassigned';
      if (!byAssignee[key]) byAssignee[key] = { name: key, tasks: [] };
      byAssignee[key].tasks.push(t);
    }
    // Sort: named assignees first, then Unassigned
    return Object.values(byAssignee).sort((a, b) => {
      if (a.name === 'Unassigned') return 1;
      if (b.name === 'Unassigned') return -1;
      return a.name.localeCompare(b.name);
    }).map((g) => ({ ...g, id: g.name }));
  }, [filtered, assigneeFilter]);

  async function handleToggle(t) {
    const project = activeProjects.find((p) => p._docId === t.projectId);
    if (!project) return;
    const phase = (project.phases || []).find((ph) => ph.id === t.phaseId);
    if (!phase) return;
    const tasks = (phase.tasks || []).map((tk) =>
      tk.id === t.id ? { ...tk, done: !tk.done } : tk,
    );
    await updatePhase(t.projectId, t.phaseId, { tasks });
  }

  async function handleAssigneeChange(t, assignee) {
    await setTaskAssignee(t.projectId, t.phaseId, t.id, assignee);
  }

  const overdueCount = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return allTasks.filter((t) => !t.done && t.phaseTargetDate && t.phaseTargetDate < today).length;
  }, [allTasks]);

  return (
    <div className={styles.wrap}>
      {/* ── Summary strip ── */}
      <div className={styles.summaryStrip}>
        {(['all', ...ASSIGNEES, 'Unassigned']).map((key) => {
          const label = key === 'all' ? 'Total open' : key;
          const val   = key === 'all'
            ? Object.values(counts).reduce((s, v) => s + v, 0)
            : (counts[key] || 0);
          return (
            <button
              key={key}
              className={`${styles.summaryChip} ${assigneeFilter === key ? styles.summaryChipActive : ''}`}
              onClick={() => setAssigneeFilter(key)}
            >
              <span className={styles.summaryNum}>{val}</span>
              <span className={styles.summaryLabel}>{label}</span>
            </button>
          );
        })}
        {overdueCount > 0 && (
          <div className={styles.overdueChip}>
            <span className={styles.summaryNum}>{overdueCount}</span>
            <span className={styles.summaryLabel}>overdue</span>
          </div>
        )}
      </div>

      {/* ── Filter bar ── */}
      <div className={styles.filterBar}>
        <input
          className={styles.search}
          placeholder="Search tasks or projects…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className={styles.pills}>
          {STATUS_OPTS.map((o) => (
            <button
              key={o.value}
              className={`${styles.pill} ${statusFilter === o.value ? styles.pillActive : ''}`}
              onClick={() => setStatusFilter(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Task groups ── */}
      {grouped.length === 0 ? (
        <div className={styles.empty}>No tasks match this filter.</div>
      ) : (
        grouped.map((group) => (
          <div key={group.id} className={styles.group}>
            <div className={styles.groupHeader}>
              <User size={13} />
              <span className={styles.groupName}>{group.name}</span>
              <span className={styles.groupCount}>{group.tasks.filter((t) => !t.done).length} open</span>
            </div>
            <ul className={styles.taskList}>
              {group.tasks.map((t) => {
                const today = new Date().toISOString().slice(0, 10);
                const overdue = !t.done && t.phaseTargetDate && t.phaseTargetDate < today;
                return (
                  <li key={`${t.projectId}-${t.phaseId}-${t.id}`} className={`${styles.taskRow} ${t.done ? styles.taskDone : ''}`}>
                    <button
                      className={`${styles.checkbox} ${t.done ? styles.checkboxDone : ''}`}
                      onClick={() => handleToggle(t)}
                    >
                      {t.done && <Check size={10} />}
                    </button>
                    <span className={styles.taskText}>{t.text}</span>
                    <button
                      className={styles.projectLink}
                      onClick={() => navigate(`/projects/${t.projectId}`)}
                      title={`${t.projectName} · Phase ${t.phaseNumber}`}
                    >
                      {t.projectName} · P{t.phaseNumber}
                    </button>
                    {t.phaseTargetDate && (
                      <span className={`${styles.dateBadge} ${overdue ? styles.dateBadgeOverdue : ''}`}>
                        {t.phaseTargetDate}
                      </span>
                    )}
                    <div className={styles.assigneeWrap}>
                      <AssigneeSelect
                        value={t.assignee}
                        onChange={(a) => handleAssigneeChange(t, a)}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
