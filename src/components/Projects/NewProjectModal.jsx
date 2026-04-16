import { useState } from 'react';
import Modal from '../Shared/Modal.jsx';
import { useProjects } from '../../context/ProjectContext.jsx';
import { OWNERS, CITIES, PROJECT_TYPES, CATEGORIES } from './constants.js';
import styles from './Projects.module.css';

export default function NewProjectModal({ onClose }) {
  const { addProject } = useProjects();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    tagline: '',
    owner: 'Kostas',
    status: 'onTrack',
    category: 'Needs Setup',
    projectType: 'Operations',
    linkedCity: '',
    startDate: new Date().toISOString().slice(0, 10),
    targetDate: '',
    plannedBudget: '',
    budgetNotes: '',
  });

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    await addProject({
      ...form,
      plannedBudget: form.plannedBudget ? Number(form.plannedBudget) : null,
      linkedCity: form.linkedCity || null,
      phases: [],
      blockers: [],
      updates: [],
      decisions: [],
      powEntries: [],
      linkedProjectIds: [],
      tags: [],
      nextAction: null,
    });
    onClose();
  }

  return (
    <Modal isOpen onClose={onClose} title="New Project" width={520}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>
            Project name *
          </label>
          <input
            className={styles.input}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. XSlide Santorini"
            autoFocus
            required
          />
        </div>

        <div>
          <label style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>
            One-line description
          </label>
          <input
            className={styles.input}
            value={form.tagline}
            onChange={(e) => set('tagline', e.target.value)}
            placeholder="What is this project?"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Owner</label>
            <select className={styles.select} value={form.owner} onChange={(e) => set('owner', e.target.value)}>
              {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Type</label>
            <select className={styles.select} value={form.projectType} onChange={(e) => set('projectType', e.target.value)}>
              {PROJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Category</label>
          <select className={styles.select} value={form.category} onChange={(e) => set('category', e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Start date</label>
            <input type="date" className={styles.input} value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Target date</label>
            <input type="date" className={styles.input} value={form.targetDate} onChange={(e) => set('targetDate', e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Linked city</label>
            <select className={styles.select} value={form.linkedCity} onChange={(e) => set('linkedCity', e.target.value)}>
              <option value="">None</option>
              {CITIES.filter(Boolean).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Planned budget (€)</label>
            <input
              type="number"
              className={styles.input}
              value={form.plannedBudget}
              onChange={(e) => set('plannedBudget', e.target.value)}
              placeholder="e.g. 5000"
              min="0"
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 8 }}>
          <button type="button" className={styles.btnGhost} onClick={onClose}>Cancel</button>
          <button type="submit" className={styles.btnPrimary} disabled={saving}>
            {saving ? 'Creating…' : 'Create Project'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
