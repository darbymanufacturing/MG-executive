/**
 * ScooterDetail.jsx — /scooters/:id
 * Unified single-scooter page with modular tabs.
 */

import { useState, useMemo, Suspense } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Pencil, ArrowLeft } from 'lucide-react';
import { useMaintenance } from '../context/MaintenanceContext.jsx';
import { useCosts } from '../context/CostContext.jsx';
import { useScooterConfig } from '../context/ScooterConfigContext.jsx';
import { TAB_REGISTRY } from '../components/Scooters/tabRegistry.js';
import ScooterHeaderStrip from '../components/Scooters/ScooterHeaderStrip.jsx';
import ScooterForm from '../components/Maintenance/fleet/ScooterForm.jsx';
import Button from '../components/Shared/Button.jsx';
import styles from './ScooterDetail.module.css';

function TabSpinner() {
  return <div className={styles.tabSpinner}>Loading…</div>;
}

export default function ScooterDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { scooters, updateScooter } = useMaintenance();
  const { config } = useCosts();
  const { enabledTabs } = useScooterConfig();
  const cities = config?.locations?.length ? config.locations : ['Nafplion', 'Corinth'];

  const scooter = useMemo(
    () => scooters.find((s) => String(s.scooterId) === String(id)),
    [scooters, id],
  );

  // Default to ?tab= query param, or first enabled tab
  const [activeTab, setActiveTab] = useState(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam && enabledTabs.some((t) => t.id === tabParam)) return tabParam;
    return enabledTabs[0]?.id || 'details';
  });
  const [editOpen,  setEditOpen]  = useState(false);

  if (!scooter) {
    return (
      <div className={styles.notFound}>
        <p>Scooter #{id} not found.</p>
        <Button variant="ghost" onClick={() => navigate('/scooters')}>
          <ArrowLeft size={14} /> Back to fleet
        </Button>
      </div>
    );
  }

  const currentTabId   = enabledTabs.find((t) => t.id === activeTab)?.id ?? enabledTabs[0]?.id;
  const tabEntry       = TAB_REGISTRY[currentTabId];
  const TabComponent   = tabEntry?.component ?? null;

  async function handleSave(form) {
    await updateScooter(scooter._docId, form);
    setEditOpen(false);
  }

  return (
    <div className={styles.page}>
      {/* Back link */}
      <div className={styles.backBar}>
        <button className={styles.backBtn} onClick={() => navigate('/scooters')}>
          <ArrowLeft size={14} /> All Scooters
        </button>
        <span className={styles.breadcrumb}>#{scooter.scooterId}</span>
      </div>

      {/* Scooter identity header */}
      <div className={styles.titleRow}>
        <div className={styles.titleLeft}>
          <h1 className={styles.scooterId}>#{scooter.scooterId}</h1>
          <span className={styles.meta}>
            {[scooter.model, scooter.city, scooter.status].filter(Boolean).join(' · ')}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil size={13} /> Edit
        </Button>
      </div>

      {/* KPI header strip (Hopp-style) */}
      <ScooterHeaderStrip scooter={scooter} />

      {/* Tab bar */}
      <div className={styles.tabBar}>
        {enabledTabs.map((t) => {
          const entry = TAB_REGISTRY[t.id];
          if (!entry) return null;
          const Icon = entry.icon;
          return (
            <button
              key={t.id}
              className={`${styles.tabBtn} ${currentTabId === t.id ? styles.tabBtnActive : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              <Icon size={14} />
              {entry.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className={styles.content}>
        <Suspense fallback={<TabSpinner />}>
          {TabComponent && (
            currentTabId === 'details'   ? <TabComponent scooter={scooter} /> :
            currentTabId === 'trips'     ? <TabComponent scooterId={scooter.scooterId} /> :
            currentTabId === 'events'    ? <TabComponent scooterId={scooter.scooterId} /> :
            currentTabId === 'repairs'   ? <TabComponent scooterId={scooter.scooterId} /> :
            currentTabId === 'finance'   ? <TabComponent scooter={scooter} /> :
            currentTabId === 'analytics' ? <TabComponent scooterId={scooter.scooterId} /> :
            <TabComponent scooter={scooter} scooterId={scooter.scooterId} />
          )}
        </Suspense>
      </div>

      {/* Edit modal */}
      <ScooterForm
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSave={handleSave}
        initial={scooter}
        cities={cities}
      />
    </div>
  );
}
